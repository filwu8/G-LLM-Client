/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createManagedWorkspace, createProjectWorkspace } from './managedWorkspace.ts'

test('automatic workspaces are stable per conversation, isolated, and preserve generated files', t => {
  const root = mkdtempSync(join(tmpdir(), 'gllm-managed-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const first = createManagedWorkspace(root, '../conversation-one', 'Conversation workspace')
  const other = createManagedWorkspace(root, 'conversation-two', 'Conversation workspace')
  assert.notEqual(first.rootPath, other.rootPath)
  assert.equal(first.kind, 'managed')
  assert.equal(first.approvalMode, 'ask')
  assert.equal(first.nativeExecution, false)
  assert.equal(first.computerAccess, false)
  assert.equal(first.browserAccess, false)
  assert.equal(existsSync(first.rootPath), true)
  writeFileSync(join(first.rootPath, 'report.txt'), 'keep the deliverable')
  const reopened = createManagedWorkspace(root, '../conversation-one', 'Conversation workspace')
  assert.equal(reopened.rootPath, first.rootPath)
  assert.equal(readFileSync(join(reopened.rootPath, 'report.txt'), 'utf8'), 'keep the deliverable')
  const project = createProjectWorkspace(root, 'project-one', '合同项目')
  assert.match(project.rootPath, /合同项目-/)
  assert.equal(createProjectWorkspace(root, 'project-one', '合同项目').rootPath, project.rootPath)
})
