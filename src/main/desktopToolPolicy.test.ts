/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationWorkspace } from '../shared/types'
import { assertDesktopCapability, browserUrl, computerCode, desktopToolDefinitions } from './desktopToolPolicy.ts'
import { needsWorkspaceApproval } from './workspaceAgentPolicy.ts'

const workspace: ConversationWorkspace = { rootPath: '.', displayName: 'test', permission: 'read-write', grantedAt: 0, lastVerifiedAt: 0 }
test('desktop tools default off; folder/native/full authorization never grants desktop capabilities', () => {
  for (const approvalMode of ['ask', 'auto', 'full'] as const) {
    const settings = { ...workspace, approvalMode, nativeExecution: true, executionMode: 'host' as const }
    assert.equal(desktopToolDefinitions(settings).length, 0)
    assert.throws(() => assertDesktopCapability(settings, 'run_computer_command'), /not been enabled/)
    assert.throws(() => assertDesktopCapability(settings, 'browser_action'), /not been enabled/)
    assert.equal(needsWorkspaceApproval(approvalMode, true, true, false, { desktop: true }), true)
    assert.equal(needsWorkspaceApproval(approvalMode, false, false, false, { desktop: true }), true)
  }
})
test('computer and browser scopes are independent and cannot operate under read-only authorization', () => {
  const settings = { ...workspace, browserAccess: true }
  assert.deepEqual(desktopToolDefinitions(settings).map(tool => tool.function.name), ['browser_action'])
  assertDesktopCapability(settings, 'browser_action')
  assert.throws(() => assertDesktopCapability(settings, 'run_computer_command'))
  assert.equal(desktopToolDefinitions({ ...settings, permission: 'read', computerAccess: true }).length, 0)
  assert.throws(() => assertDesktopCapability({ ...settings, permission: 'read' }, 'browser_action'))
})
test('browser rejects local file/protocol execution and embedded credentials', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'gllm://key', 'https://user:secret@example.com']) assert.throws(() => browserUrl(url))
  assert.equal(browserUrl('https://example.com'), 'https://example.com/')
})
test('computer commands must have a reviewable purpose and bounded source', () => {
  assert.equal(computerCode({ purpose: 'inspect', code: 'echo ok' }), 'echo ok')
  for (const args of [{ code: 'echo ok' }, { purpose: 'inspect', code: ' ' }, { purpose: 'inspect', code: 'a'.repeat(32001) }]) assert.throws(() => computerCode(args))
})
