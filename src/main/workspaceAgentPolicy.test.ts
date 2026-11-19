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
import { assertWorkspacePathAllowed, isProtectedWorkspacePath, loadWorkspaceEnvironment, loadWorkspaceInstructions, needsWorkspaceApproval, workspaceApprovalInstructions, selectWorkspaceEnvironment, redactWorkspaceSecrets, retryableModelStatuses, isTransientModelHttpStatus, repeatedFailureSignature, trackOperationOutcome, workspaceFailureHint, mergeFailureHint, resumedToolWarning } from './workspaceAgentPolicy.ts'

test('transient upstream 5xx faults retry in place instead of failing the run', () => {
  // A gateway "Database error" surfaces as 500/503; these must be replayed.
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(retryableModelStatuses.has(status), true, `${status} should be retryable`)
  }
  // Client errors are deterministic and must not be blindly replayed.
  for (const status of [200, 400, 401, 403, 404, 422]) {
    assert.equal(retryableModelStatuses.has(status), false, `${status} should not be retryable`)
  }
  for (const status of [500, 502, 503, 504]) {
    assert.equal(isTransientModelHttpStatus(status), true, `${status} should allow continuation`)
  }
  assert.equal(isTransientModelHttpStatus(429), false)
  assert.equal(isTransientModelHttpStatus(400), false)
  assert.equal(isTransientModelHttpStatus(undefined), false)
})

test('three approval modes cover file writes, restricted scripts, sandbox/host jobs and external tools', () => {
  const cases = [
    { name: 'read or job log', script: false, write: false, native: false, boundary: {}, expected: [false, false, false] },
    { name: 'file write or previewed replacement', script: false, write: true, native: false, boundary: {}, expected: [true, false, false] },
    { name: 'restricted JavaScript', script: true, write: true, native: false, boundary: {}, expected: [true, false, false] },
    { name: 'sandbox Python/Shell including background', script: true, write: true, native: true, boundary: { executionMode: 'sandbox' as const }, expected: [true, false, false] },
    { name: 'host Python/Shell including background', script: true, write: true, native: true, boundary: { executionMode: 'host' as const }, expected: [true, true, true] },
    { name: 'HTTP extension', script: false, write: true, native: false, boundary: { external: true }, expected: [true, true, false] },
    { name: 'HTTP extension claiming read-only', script: false, write: false, native: false, boundary: { external: true }, expected: [true, true, false] }
  ]
  for (const entry of cases) {
    for (const [index, mode] of ['ask', 'auto', 'full'].entries()) {
      assert.equal(needsWorkspaceApproval(mode, entry.script, entry.write, entry.native, entry.boundary), entry.expected[index], `${mode}: ${entry.name}`)
    }
  }
})

test('full access still requires approval for host jobs that can write outside the workspace', () => {
  // The write boundary is a hard limit: full mode never waives approval for
  // unsandboxed execution, which is the only path that can touch files outside
  // the authorized folder. Sandboxed jobs and in-workspace writes stay automatic.
  assert.equal(needsWorkspaceApproval('full', true, true, true, { executionMode: 'host' }), true)
  assert.equal(needsWorkspaceApproval('full', true, true, true, { executionMode: 'sandbox' }), false)
  assert.equal(needsWorkspaceApproval('full', true, true, false, {}), false)
  assert.equal(needsWorkspaceApproval('full', false, true, false, {}), false)
  // desktop/browser boundaries remain hard even in full mode.
  assert.equal(needsWorkspaceApproval('full', true, true, true, { executionMode: 'host', desktop: true }), true)
  assert.match(workspaceApprovalInstructions('full'), /Host \(unsandboxed\).*require per-call approval/)
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

test('project config is bounded, root-scoped and parsed without executing shell substitutions', async (t) => {
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
    try {
      await symlink(resolve(root, '.env'), resolve(root, 'AGENTS.md'))
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && ['EPERM', 'EACCES', 'ENOTSUP'].includes(String(error.code))) {
        t.skip('symbolic links are not permitted for this Windows user')
        return
      }
      throw error
    }
    await assert.rejects(loadWorkspaceInstructions(root), /symbolic links/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('credential paths and runtime-control variables are protected', () => {
  for (const path of ['.env', 'nested/.env.production', '.ssh/key', '.git/config', 'nested\\.aws\\credentials']) assert.equal(isProtectedWorkspacePath(path), true)
  for (const path of ['.env.example', 'data.csv', 'src/environment.ts']) assert.equal(isProtectedWorkspacePath(path), false)
  for (const name of ['PATH', 'PATHEXT', 'BASH_ENV', 'NODE_OPTIONS', 'PYTHONPATH', 'DYLD_INSERT_LIBRARIES', 'ELECTRON_RUN_AS_NODE', 'LOCALAPPDATA', 'SystemDrive', 'windir', 'PSModulePath', 'PSModuleAnalysisCachePath']) {
    assert.throws(() => selectWorkspaceEnvironment({ [name]: 'unsafe' }, [name]), /runtime/)
  }
  assert.throws(() => selectWorkspaceEnvironment({}, ['MISSING']), /missing/)
})

test('git metadata error redirects to git_read while credentials stay hard-blocked', () => {
  assert.throws(() => assertWorkspacePathAllowed('.git/config'), /git_read/)
  assert.throws(() => assertWorkspacePathAllowed('nested/.git/HEAD'), /仓库元数据/)
  for (const path of ['.env', '.ssh/key', 'nested\\.aws\\credentials', '.gnupg/key']) {
    assert.throws(() => assertWorkspacePathAllowed(path), /Protected credentials/)
    let message = ''
    try { assertWorkspacePathAllowed(path) } catch (error) { message = (error as Error).message }
    assert.doesNotMatch(message, /git_read/)
  }
})

test('repeated failure signature ignores free-text fields but keeps operation identity', () => {
  const a = repeatedFailureSignature('git_write', JSON.stringify({ operation: 'stash', repo: 'erpv3main', purpose: 'backup before sync', message: 'backup-20261119' }))
  const b = repeatedFailureSignature('git_write', JSON.stringify({ operation: 'stash', repo: 'erpv3main', purpose: 'retry backup', message: 'backup-20261119-erpv3main' }))
  const c = repeatedFailureSignature('git_write', JSON.stringify({ operation: 'reset', repo: 'erpv3main', purpose: 'backup' }))
  const d = repeatedFailureSignature('git_write', JSON.stringify({ operation: 'stash', repo: 'other-repo', purpose: 'backup' }))
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.notEqual(a, d)
  assert.equal(repeatedFailureSignature('git_read', undefined).startsWith('git_read:'), true)
  assert.equal(repeatedFailureSignature('git_write', '{bad json').startsWith('git_write:'), true)
})

test('successful reads never reset the failure streak of a different failing operation', () => {
  const counts = new Map<string, number>()
  const writeKey = repeatedFailureSignature('git_write', JSON.stringify({ operation: 'stash', repo: 'erpv3main' }))
  const readKey = repeatedFailureSignature('git_read', JSON.stringify({ operation: 'status' }))
  assert.equal(trackOperationOutcome(counts, writeKey, false), 1)
  assert.equal(trackOperationOutcome(counts, writeKey, false), 2)
  assert.equal(trackOperationOutcome(counts, readKey, true), 0)
  assert.equal(trackOperationOutcome(counts, writeKey, false), 3)
  assert.equal(counts.get(writeKey), 3)
  assert.equal(counts.has(readKey), false)
  assert.equal(trackOperationOutcome(counts, writeKey, true), 0)
  assert.equal(counts.has(writeKey), false)
})

test('repeated failure limiter stops after the bounded number of identical failures', () => {
  const counts = new Map<string, number>()
  const key = repeatedFailureSignature('git_write', JSON.stringify({ operation: 'stash' }))
  let stop: number | undefined
  for (let i = 1; i <= 8; i++) {
    const streak = trackOperationOutcome(counts, key, false)
    if (streak >= 4 && stop === undefined) stop = streak
  }
  assert.equal(stop, 4)
})

test('workspace failure hint classifies lock, timeout, permission and generic errors', () => {
  assert.equal(workspaceFailureHint("error: Unable to create index.lock': File exists. Another git process"), 'lock')
  assert.equal(workspaceFailureHint('Execution timed out after 120000ms'), 'timeout')
  assert.equal(workspaceFailureHint('fatal: Permission denied'), 'permission')
  assert.equal(workspaceFailureHint('some other failure'), 'generic')
})

test('resumed interrupted tool produces a verification warning and can be cleared', () => {
  let pendingTool: string | undefined = '修改 Git 仓库'
  const note = resumedToolWarning(true, pendingTool, (tool) => `verify ${tool}`)
  assert.equal(note, 'verify 修改 Git 仓库')
  pendingTool = undefined
  assert.equal(resumedToolWarning(true, pendingTool, (tool) => `verify ${tool}`), undefined)
  assert.equal(resumedToolWarning(false, '修改 Git 仓库', (tool) => `verify ${tool}`), undefined)
})

test('failure hint stays on the most actionable symptom across a streak', () => {
  // The ERPv3 case: slow reset times out first, then leaves index.lock and
  // fails with "file exists". The final symptom was "timed out" but the real,
  // fixable blocker is the lock — it must win so the user is not told to
  // "check the network".
  let hint = mergeFailureHint(undefined, workspaceFailureHint('Execution timed out'))
  assert.equal(hint, 'timeout')
  hint = mergeFailureHint(hint, workspaceFailureHint("fatal: Unable to create '.git/index.lock': File exists. Another git process"))
  assert.equal(hint, 'lock')
  hint = mergeFailureHint(hint, workspaceFailureHint('Execution timed out'))
  assert.equal(hint, 'lock', 'a later vaguer timeout must not overwrite the lock hint')
  // Permission outranks timeout but not lock.
  assert.equal(mergeFailureHint('timeout', 'permission'), 'permission')
  assert.equal(mergeFailureHint('permission', 'lock'), 'lock')
  assert.equal(mergeFailureHint(undefined, undefined), undefined)
})
