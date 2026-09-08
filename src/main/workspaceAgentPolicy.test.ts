/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { isProtectedWorkspacePath, loadWorkspaceEnvironment, loadWorkspaceInstructions, needsWorkspaceApproval, workspaceApprovalInstructions, selectWorkspaceEnvironment, redactWorkspaceSecrets } from './workspaceAgentPolicy.ts'

test('three approval modes cover file writes, restricted scripts, sandbox/host jobs and external tools', () => {
  const cases = [
    { name: 'read or job log', script: false, write: false, native: false, boundary: {}, expected: [false, false, false] },
    { name: 'file write or previewed replacement', script: false, write: true, native: false, boundary: {}, expected: [true, false, false] },
    { name: 'restricted JavaScript', script: true, write: true, native: false, boundary: {}, expected: [true, false, false] },
    { name: 'sandbox Python/Shell including background', script: true, write: true, native: true, boundary: { executionMode: 'sandbox' as const }, expected: [true, false, false] },
    { name: 'host Python/Shell including background', script: true, write: true, native: true, boundary: { executionMode: 'host' as const }, expected: [true, true, false] },
    { name: 'HTTP extension', script: false, write: true, native: false, boundary: { external: true }, expected: [true, true, false] },
    { name: 'HTTP extension claiming read-only', script: false, write: false, native: false, boundary: { external: true }, expected: [true, true, false] }
  ]
  for (const entry of cases) {
    for (const [index, mode] of ['ask', 'auto', 'full'].entries()) {
      assert.equal(needsWorkspaceApproval(mode, entry.script, entry.write, entry.native, entry.boundary), entry.expected[index], `${mode}: ${entry.name}`)
    }
  }
})

test('unknown modes and native boundaries request approval; model guidance follows the selected mode', () => {
  for (const mode of [undefined, 'invalid']) {
    assert.equal(needsWorkspaceApproval(mode, true, true, true, { executionMode: 'sandbox' }), true)
    assert.equal(needsWorkspaceApproval(mode, false, true), true)
    assert.match(workspaceApprovalInstructions(mode), /Ask for approval/)
  }
  assert.equal(needsWorkspaceApproval('auto', true, false, true), true)
  assert.match(workspaceApprovalInstructions('auto'), /sandbox.*execute automatically/)
  assert.match(workspaceApprovalInstructions('full'), /without per-operation approval/)
  for (const mode of ['ask', 'auto', 'full']) {
    assert.match(workspaceApprovalInstructions(mode), /does not enable disabled tools/)
    assert.match(workspaceApprovalInstructions(mode), /instead of asking the user to approve again/)
  }
})

test('project config is bounded, root-scoped and parsed without executing shell substitutions', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-config-test-'))
  try {
    assert.equal(await loadWorkspaceInstructions(root), undefined)
    await writeFile(resolve(root, 'AGENTS.md'), 'Use CSV output.')
    await writeFile(resolve(root, '.env'), 'TOKEN="test-private-token"\nCOMMAND=$(touch pwned)\nMULTILINE="hello\nworld"')
    assert.equal(await loadWorkspaceInstructions(root), 'Use CSV output.')
    const env = await loadWorkspaceEnvironment(root)
    assert.equal(env.COMMAND, '$(touch pwned)')
    assert.equal(env.MULTILINE, 'hello\nworld')
    assert.deepEqual({ ...selectWorkspaceEnvironment(env, ['TOKEN']) }, { TOKEN: 'test-private-token' })
    assert.equal(redactWorkspaceSecrets('result=test-private-token', env), 'result=[REDACTED]')
    await writeFile(resolve(root, 'AGENTS.md'), 'x'.repeat(32_769))
    await assert.rejects(loadWorkspaceInstructions(root), /at most/)
    await rm(resolve(root, 'AGENTS.md'))
    await symlink(resolve(root, '.env'), resolve(root, 'AGENTS.md'))
    await assert.rejects(loadWorkspaceInstructions(root), /symbolic links/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('credential paths and runtime-control variables are protected', () => {
  for (const path of ['.env', 'nested/.env.production', '.ssh/key', '.git/config', 'nested\\.aws\\credentials']) assert.equal(isProtectedWorkspacePath(path), true)
  for (const path of ['.env.example', 'data.csv', 'src/environment.ts']) assert.equal(isProtectedWorkspacePath(path), false)
  for (const name of ['PATH', 'BASH_ENV', 'NODE_OPTIONS', 'PYTHONPATH', 'DYLD_INSERT_LIBRARIES', 'ELECTRON_RUN_AS_NODE', 'LOCALAPPDATA', 'SystemDrive', 'windir', 'PSModulePath', 'PSModuleAnalysisCachePath']) {
    assert.throws(() => selectWorkspaceEnvironment({ [name]: 'unsafe' }, [name]), /runtime/)
  }
  assert.throws(() => selectWorkspaceEnvironment({}, ['MISSING']), /missing/)
})
