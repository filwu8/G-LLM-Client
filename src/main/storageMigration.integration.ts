/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Conversation } from '../shared/types'

const fixture = process.argv[2]
for (const folder of ['profile', 'app-data']) mkdirSync(join(fixture, folder))
app.setPath('userData', join(fixture, 'profile'))
app.setPath('appData', join(fixture, 'app-data'))

async function main() {
  await app.whenReady()
  const storage = await import('./storage')
  const original = storage.getDataLocationInfo().activePath
  const workspace = storage.ensureConversationWorkspace('migration-integration')
  assert.equal(storage.ensureConversationWorkspace('migration-integration').rootPath, workspace.rootPath)
  assert.equal(workspace.computerAccess, false)
  const report = join(workspace.rootPath, 'reports', '结果.txt')
  mkdirSync(join(workspace.rootPath, 'reports'))
  writeFileSync(report, 'generated report must survive migration')
  for (let i = 0; i < 120; i++) writeFileSync(join(workspace.rootPath, `file-${i}.bin`), Buffer.alloc(i * 300, i))
  writeFileSync(join(workspace.rootPath, 'large.bin'), Buffer.alloc(2 * 1024 * 1024 + 37, 23))
  const external = join(fixture, 'external-project')
  mkdirSync(external)
  writeFileSync(join(external, 'external.txt'), 'leave in place')
  const conversation: Conversation = { id: 'migration-integration', assistantId: storage.getAssistants()[0].id, projectId: storage.getActiveProjectId(), title: 'Migration', createdAt: Date.now(), updatedAt: Date.now(), workspace, messages: [{ id: 'artifact', role: 'assistant', createdAt: Date.now(), content: `[Report](${pathToFileURL(report).href})`, workspaceArtifactRoot: workspace.rootPath, workspaceChangedFiles: ['reports/结果.txt'] }] }
  storage.saveConversation(conversation)
  const automatic = storage.saveConversation({ ...conversation, id: 'ordinary-conversation', workspace: undefined, messages: [{ id: 'hello', role: 'user', createdAt: Date.now(), content: 'Hello' }] })
  assert.equal(automatic.workspace?.kind, 'managed')
  assert.equal(automatic.workspace?.computerAccess, false)
  assert.notEqual(automatic.workspace?.rootPath, workspace.rootPath)
  storage.saveConversation({ ...conversation, id: 'external-conversation', workspace: { ...workspace, rootPath: external, kind: 'external' }, messages: [] })
  const vault = join(app.getPath('userData'), 'agent-credentials')
  mkdirSync(vault, { recursive: true })
  const binding = (root: string) => { const path = realpathSync(root); return createHash('sha256').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex') + '.json' }
  const encrypted = '{"declarations":[{"name":"TEST_KEY","description":"test"}],"values":{"TEST_KEY":"opaque-ciphertext"}}'
  writeFileSync(join(vault, binding(workspace.rootPath)), encrypted)
  const target = join(fixture, 'new-data')
  const result = storage.migrateDataRoot(target)
  assert.equal(result.restartRequired, false)
  assert.equal(result.info.pendingRestart, false)
  assert.equal(result.info.activePath, target)
  const moved = storage.getConversations().find(item => item.id === conversation.id)!
  assert.ok(moved.workspace!.rootPath.startsWith(target))
  assert.equal(moved.messages[0].workspaceArtifactRoot, moved.workspace!.rootPath)
  const movedReport = join(moved.workspace!.rootPath, 'reports', '结果.txt')
  assert.equal(readFileSync(movedReport, 'utf8'), readFileSync(report, 'utf8'))
  assert.equal(readFileSync(join(moved.workspace!.rootPath, 'large.bin')).length, 2 * 1024 * 1024 + 37)
  assert.ok(moved.messages[0].content.includes(pathToFileURL(movedReport).href))
  assert.equal(storage.getConversations().find(item => item.id === 'external-conversation')!.workspace!.rootPath, external)
  assert.equal(readFileSync(join(vault, binding(moved.workspace!.rootPath)), 'utf8'), encrypted)
  // A renderer holding old paths cannot reintroduce them after the switch.
  assert.equal(storage.saveConversation(conversation).workspace!.rootPath, moved.workspace!.rootPath)
  assert.equal(storage.resolveCurrentDataPath(workspace.rootPath), moved.workspace!.rootPath)
  const generated = storage.saveGeneratedImageResource(Buffer.from('fixture-image'))
  assert.ok(generated.absolutePath.startsWith(target))
  assert.equal(storage.getDataResourceFilePathFromUrl(generated.url), generated.absolutePath)
  symlinkSync(external, join(target, 'linked-resources'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(storage.getDataResourceFilePathFromUrl('gllm-data://linked-resources/new-image.png'), null, 'A prospective file below an outside directory link must be rejected')
  rmSync(join(moved.workspace!.rootPath, 'file-0.bin'))
  const restored = storage.resetDataRoot()
  assert.equal(restored.info.activePath, original)
  assert.equal(restored.restartRequired, false)
  assert.equal(storage.getConversations().find(item => item.id === conversation.id)!.workspace!.rootPath, workspace.rootPath)
  assert.equal(readFileSync(join(vault, binding(workspace.rootPath)), 'utf8'), encrypted)
  assert.equal(existsSync(join(workspace.rootPath, 'file-0.bin')), false, 'deleted files must not reappear when switching back')
  const alias = join(fixture, 'alias-to-current')
  symlinkSync(original, alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(storage.migrateDataRoot(alias).changed, false)
  assert.equal(existsSync(report), true)
  // A destination junction/symlink must fail before the active root changes.
  const failed = join(fixture, 'failed-migration')
  mkdirSync(failed)
  symlinkSync(external, join(failed, 'agent-workspaces'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => storage.migrateDataRoot(failed), /symbolic link/)
  assert.equal(storage.getDataLocationInfo().activePath, original)
  assert.equal(existsSync(report), true)
  assert.equal(readFileSync(join(external, 'external.txt'), 'utf8'), 'leave in place')
  console.log('Storage migration integration passed: automatic allocation, 120+ files, verified copy, live switch, references, ciphertext bindings, stale paths, reset, external folders and failure rollback.')
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
