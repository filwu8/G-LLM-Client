/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  configureGitWriteGrantStorage,
  forgetGitWriteGrants,
  hasGitWriteGrant,
  rememberGitWriteGrant,
  GIT_WRITE_DESTRUCTIVE_GRANT_TTL_MS,
  GIT_WRITE_GRANT_TTL_MS
} from './workspaceGitApproval.ts'

const ROOT = join(tmpdir(), 'repo-a')

test('no grant is remembered before the user approves anything', () => {
  forgetGitWriteGrants()
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch'), false)
})

test('an approved operation kind is reused for the same conversation and workspace', () => {
  forgetGitWriteGrants()
  rememberGitWriteGrant('conv-1', ROOT, 'fetch')
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch'), true)
})

test('a different operation kind still requires its own approval', () => {
  forgetGitWriteGrants()
  rememberGitWriteGrant('conv-1', ROOT, 'fetch')
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'reset'), false)
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'clean'), false)
})

test('grants do not leak across repositories inside the same workspace', () => {
  forgetGitWriteGrants()
  rememberGitWriteGrant('conv-1', ROOT, 'pull', { repo: '' })
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'pull', { repo: '' }), true)
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'pull', { repo: 'erpv3main' }), false)
  rememberGitWriteGrant('conv-1', ROOT, 'pull', { repo: 'erpv3main' })
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'pull', { repo: 'erpv3main' }), true)
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'pull', { repo: 'volumes/erpv3-extra-addons' }), false)
  // Windows path normalization must not create a second grant scope.
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'pull', { repo: 'ERPV3MAIN\\' }), true)
})

test('grants do not leak across conversations', () => {
  forgetGitWriteGrants()
  rememberGitWriteGrant('conv-1', ROOT, 'checkout')
  assert.equal(hasGitWriteGrant('conv-2', ROOT, 'checkout'), false)
})

test('grants do not leak across workspaces of the same conversation', () => {
  forgetGitWriteGrants()
  rememberGitWriteGrant('conv-1', join(tmpdir(), 'repo-a'), 'reset')
  assert.equal(hasGitWriteGrant('conv-1', join(tmpdir(), 'repo-b'), 'reset'), false)
})

test('changing the approval mode invalidates earlier grants', () => {
  forgetGitWriteGrants()
  rememberGitWriteGrant('conv-1', ROOT, 'fetch', { approvalMode: 'ask' })
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch', { approvalMode: 'ask' }), true)
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch', { approvalMode: 'auto' }), false)
})

test('reversible operations expire after the standard TTL', () => {
  forgetGitWriteGrants()
  const now = 1_000_000
  rememberGitWriteGrant('conv-1', ROOT, 'fetch', { now })
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch', { now: now + GIT_WRITE_GRANT_TTL_MS - 1 }), true)
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch', { now: now + GIT_WRITE_GRANT_TTL_MS }), false)
})

test('destructive operations keep a much shorter grace window', () => {
  forgetGitWriteGrants()
  const now = 1_000_000
  rememberGitWriteGrant('conv-1', ROOT, 'reset', { now })
  assert.equal(
    hasGitWriteGrant('conv-1', ROOT, 'reset', { now: now + GIT_WRITE_DESTRUCTIVE_GRANT_TTL_MS - 1 }),
    true
  )
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'reset', { now: now + GIT_WRITE_DESTRUCTIVE_GRANT_TTL_MS }), false)
  assert.ok(GIT_WRITE_DESTRUCTIVE_GRANT_TTL_MS < GIT_WRITE_GRANT_TTL_MS)
})

test('empty identifiers never create a grant', () => {
  forgetGitWriteGrants()
  rememberGitWriteGrant('', ROOT, 'fetch')
  rememberGitWriteGrant('conv-1', '  ', 'fetch')
  rememberGitWriteGrant('conv-1', ROOT, '  ')
  assert.equal(hasGitWriteGrant('', ROOT, 'fetch'), false)
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch'), false)
})

test('forgetting one conversation keeps other conversations intact', () => {
  forgetGitWriteGrants()
  rememberGitWriteGrant('conv-1', ROOT, 'fetch')
  rememberGitWriteGrant('conv-2', ROOT, 'fetch')
  forgetGitWriteGrants('conv-1')
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch'), false)
  assert.equal(hasGitWriteGrant('conv-2', ROOT, 'fetch'), true)
})

test('clearing everything removes all grants', () => {
  rememberGitWriteGrant('conv-1', ROOT, 'fetch')
  rememberGitWriteGrant('conv-2', ROOT, 'pull')
  forgetGitWriteGrants()
  assert.equal(hasGitWriteGrant('conv-1', ROOT, 'fetch'), false)
  assert.equal(hasGitWriteGrant('conv-2', ROOT, 'pull'), false)
})

test('grants survive a restart by loading from the configured directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'git-approvals-'))
  try {
    forgetGitWriteGrants()
    configureGitWriteGrantStorage(() => directory)
    rememberGitWriteGrant('conv-9', ROOT, 'fetch', { approvalMode: 'ask' })
    await new Promise((resolve) => setTimeout(resolve, 700))

    const stored = await readFile(join(directory, 'git-approvals.json'), 'utf8')
    assert.match(stored, /fetch/)

    // Simulate a process restart: drop memory without rewriting the file.
    configureGitWriteGrantStorage(null)
    forgetGitWriteGrants()
    configureGitWriteGrantStorage(() => directory)
    assert.equal(hasGitWriteGrant('conv-9', ROOT, 'fetch', { approvalMode: 'ask' }), true)
    assert.equal(hasGitWriteGrant('conv-9', join(tmpdir(), 'repo-z'), 'fetch', { approvalMode: 'ask' }), false)
  } finally {
    configureGitWriteGrantStorage(null)
    forgetGitWriteGrants()
    await rm(directory, { recursive: true, force: true })
  }
})

test('a corrupt approvals file never blocks a fresh approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'git-approvals-bad-'))
  try {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(directory, 'git-approvals.json'), '{not json', 'utf8')
    forgetGitWriteGrants()
    configureGitWriteGrantStorage(() => directory)
    assert.equal(hasGitWriteGrant('conv-8', ROOT, 'fetch'), false)
    rememberGitWriteGrant('conv-8', ROOT, 'fetch')
    assert.equal(hasGitWriteGrant('conv-8', ROOT, 'fetch'), true)
  } finally {
    configureGitWriteGrantStorage(null)
    forgetGitWriteGrants()
    await rm(directory, { recursive: true, force: true })
  }
})
