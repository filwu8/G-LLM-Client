/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { Conversation, Project, SkillConfig } from '../shared/types'
import { relocateConversation, relocateDataPath, relocateStoredData } from './dataRelocation.ts'

const previous = resolve(tmpdir(), 'gllm-original'), next = resolve(tmpdir(), 'gllm-moved'), external = resolve(tmpdir(), 'user-project')
test('relocation updates structured workspace, artifact, project, skill and file-link references only', () => {
  const workspace = join(previous, 'agent-workspaces', 'conversation')
  const targetWorkspace = join(next, 'agent-workspaces', 'conversation')
  const file = join(workspace, 'report.txt'), url = pathToFileURL(file).href
  const conversation: Conversation = { id: 'one', assistantId: 'assistant', title: 'test', createdAt: 1, updatedAt: 1, workspace: { rootPath: workspace, displayName: 'Workspace', kind: 'managed', permission: 'read-write', computerAccess: false, approvalMode: 'ask', grantedAt: 1, lastVerifiedAt: 1 }, messages: [{ id: 'message', role: 'assistant', createdAt: 1, content: `Original path was ${file}. [Open report](${url})`, workspaceArtifactRoot: workspace, workspaceChangedFiles: ['report.txt'] }] }
  const state = { conversations: [conversation, { ...conversation, id: 'external', workspace: { ...conversation.workspace!, rootPath: external } }], projects: [{ id: 'project', name: 'P', workspacePath: workspace, createdAt: 1, updatedAt: 1 }] as Project[], skills: [{ sourceType: 'local', sourceLocator: join(workspace, 'SKILL.md') }] as SkillConfig[], dataRootAliases: [] as string[], privateSetting: previous }
  const moved = relocateStoredData(state, previous, next)
  assert.equal(moved.conversations[0].workspace?.rootPath, targetWorkspace)
  assert.equal(moved.conversations[0].messages[0].workspaceArtifactRoot, targetWorkspace)
  assert.deepEqual(moved.conversations[0].messages[0].workspaceChangedFiles, ['report.txt'])
  assert.ok(moved.conversations[0].messages[0].content.includes(`Original path was ${file}.`))
  assert.ok(moved.conversations[0].messages[0].content.includes(pathToFileURL(join(targetWorkspace, 'report.txt')).href))
  assert.equal(moved.conversations[1].workspace?.rootPath, external)
  assert.equal(moved.projects[0].workspacePath, targetWorkspace)
  assert.equal(moved.skills[0].sourceLocator, join(targetWorkspace, 'SKILL.md'))
  assert.equal(moved.privateSetting, previous)
  assert.deepEqual(moved.dataRootAliases, [previous])
  assert.equal(relocateConversation(conversation, previous, next).workspace?.computerAccess, false)
})
test('path rewrites respect directory boundaries, relative paths and already active locations', () => {
  assert.equal(relocateDataPath(`${previous}-another/file`, previous, next), `${previous}-another/file`)
  assert.equal(relocateDataPath('../file.txt', previous, next), '../file.txt')
  const nested = join(previous, 'nested')
  assert.equal(relocateDataPath(join(nested, 'file.txt'), previous, nested), join(nested, 'file.txt'))
  assert.equal(relocateDataPath(join(previous, 'folder', 'file.txt'), previous, next), join(next, 'folder', 'file.txt'))
})
