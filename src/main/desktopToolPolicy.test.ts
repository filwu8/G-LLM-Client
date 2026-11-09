/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConversationWorkspace } from '../shared/types'
import { assertDesktopCapability, browserUrl, computerCode, desktopToolDefinitions } from './desktopToolPolicy.ts'
import { needsWorkspaceApproval } from './workspaceAgentPolicy.ts'
import { windowKeyCodes, windowScreenshotPoint } from './windowControlPolicy.ts'

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
test('Windows UI control needs a separate grant and exposes screenshots only to vision models', () => {
  const legacy = { ...workspace, approvalMode: 'full' as const, computerAccess: true, browserAccess: true }
  assert.throws(() => assertDesktopCapability(legacy, 'computer_window', 'win32'))
  assert.throws(() => assertDesktopCapability(legacy, 'browser_window', 'win32'))
  const browser = { ...workspace, browserWindowAccess: true }
  assertDesktopCapability(browser, 'browser_window', 'win32')
  assert.throws(() => assertDesktopCapability(browser, 'computer_window', 'win32'))
  assert.throws(() => assertDesktopCapability(browser, 'browser_window', 'darwin'))
  assert.throws(() => assertDesktopCapability({ ...browser, permission: 'read' }, 'browser_window', 'win32'))
  const computer = { ...workspace, computerWindowAccess: true }
  assert.deepEqual(desktopToolDefinitions(computer, true, 'win32').map(tool => tool.function.name), ['computer_window'])
  assert.equal(desktopToolDefinitions(computer, true, 'linux').length, 0)
  for (const vision of [false, true]) {
    const [tool] = desktopToolDefinitions(browser, vision, 'win32')
    const action = (tool.function.parameters.properties as { action: { enum: string[] } }).action
    assert.equal(action.enum.includes('screenshot'), vision)
    assert.equal(action.enum.includes('type'), false)
  }
})
test('browser rejects local file/protocol execution and embedded credentials', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'gllm://key', 'https://user:secret@example.com']) assert.throws(() => browserUrl(url))
  assert.equal(browserUrl('https://example.com'), 'https://example.com/')
})
test('window shortcuts keep browser keys and desktop combinations in their own scopes', () => {
  assert.deepEqual(windowKeyCodes('Ctrl+Shift+Tab', false), [0x11, 0x10, 0x09])
  assert.deepEqual(windowKeyCodes('Shift+Tab', true), [0x10, 0x09])
  assert.throws(() => windowKeyCodes('Ctrl+L', true), /dedicated/)
  for (const chord of ['Win+R', 'Ctrl+Ctrl+A', 'A+B', 'Ctrl', 'toString']) assert.throws(() => windowKeyCodes(chord, false))
})
test('screenshot coordinates map to the selected frame on scaled and offset monitors', () => {
  const image = { width: 800, height: 600 }
  const frame = { left: -1600, top: 50, width: 1600, height: 1200 }
  assert.deepEqual(windowScreenshotPoint(0, 0, image, frame), { x: -1599, y: 51 })
  assert.deepEqual(windowScreenshotPoint(799, 599, image, frame), { x: -1, y: 1249 })
  for (const [x, y] of [[800, 0], [0, -1], [1.5, 0], ['1', 0]]) assert.throws(() => windowScreenshotPoint(x, y, image, frame), /coordinates/)
  assert.throws(() => windowScreenshotPoint(0, 0, undefined, frame), /latest window screenshot/)
})
test('computer commands must have a reviewable purpose and bounded source', () => {
  assert.equal(computerCode({ purpose: 'inspect', code: 'echo ok' }), 'echo ok')
  for (const args of [{ code: 'echo ok' }, { purpose: 'inspect', code: ' ' }, { purpose: 'inspect', code: 'a'.repeat(32001) }]) assert.throws(() => computerCode(args))
})
