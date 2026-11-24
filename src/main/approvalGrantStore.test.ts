/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONFIGURED_RULES_FILE,
  GRANTED_RULES_FILE,
  configureApprovalGrantStorage,
  evaluateApprovalRules,
  forgetApprovalGrants,
  listApprovalGrants,
  loadConfiguredApprovalRules,
  rememberApprovalGrant
} from './approvalGrantStore.ts'
import type { PermissionRule } from './approvalRules.ts'

const CI = { caseInsensitive: false }
const rule = (action: string, resource: string, effect: PermissionRule['effect']): PermissionRule => ({ action, resource, effect })

function withStore(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'gllm-approval-grants-'))
  configureApprovalGrantStorage(() => directory)
  try {
    run(directory)
  } finally {
    // Detaching first makes the cleanup invisible to the store, so clearing the
    // in-memory map cannot rewrite the file this test just asserted on. Without
    // this the suite also leaks one temp directory per run; a previous leak in
    // this repository accumulated hundreds before anyone noticed.
    configureApprovalGrantStorage(null)
    forgetApprovalGrants()
    rmSync(directory, { recursive: true, force: true })
  }
}

test('a grant is written through to disk and scoped to one workspace', () => {
  withStore((directory) => {
    rememberApprovalGrant('/work/alpha', rule('shell', 'git status *', 'allow'))
    assert.deepEqual(listApprovalGrants('/work/alpha').map((entry) => entry.resource), ['git status *'])
    // Another workspace must not inherit it.
    assert.deepEqual(listApprovalGrants('/work/beta'), [])
    // The click has to reach disk immediately, not after a debounce: a quit
    // inside that window would drop a decision the user already made.
    const persisted = JSON.parse(readFileSync(join(directory, GRANTED_RULES_FILE), 'utf8'))
    const scopes = Object.keys(persisted.workspaces)
    assert.equal(scopes.length, 1, 'only the granted workspace is persisted')
    assert.deepEqual(persisted.workspaces[scopes[0]], [rule('shell', 'git status *', 'allow')])
  })
})

test('workspace scoping folds case on Windows only', () => {
  // The scope key has to match how the filesystem compares paths, otherwise a
  // grant recorded for `C:/Work` silently stops applying to `c:/work`.
  withStore(() => {
    rememberApprovalGrant('/Work/Alpha', rule('edit', 'a.txt', 'allow'))
    const same = process.platform === 'win32' ? '/work/alpha' : '/Work/Alpha'
    const other = process.platform === 'win32' ? '/other' : '/work/alpha'
    assert.equal(listApprovalGrants(same).length, 1)
    assert.equal(listApprovalGrants(other).length, 0)
  })
})

test('a grants file on disk is loaded on first use', () => {
  // Seeded before the store is pointed at the directory, so this exercises the
  // load path rather than the in-memory map.
  const directory = mkdtempSync(join(tmpdir(), 'gllm-approval-grants-'))
  try {
    writeFileSync(join(directory, GRANTED_RULES_FILE), JSON.stringify({
      version: 1,
      workspaces: { '/seeded': [rule('shell', 'npm test *', 'allow')] }
    }), 'utf8')
    configureApprovalGrantStorage(() => directory)
    assert.deepEqual(listApprovalGrants('/seeded').map((entry) => entry.resource), ['npm test *'])
  } finally {
    configureApprovalGrantStorage(null)
    forgetApprovalGrants()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('recording the same rule twice does not accumulate duplicates', () => {
  withStore(() => {
    rememberApprovalGrant('/work', rule('edit', 'a.txt', 'allow'))
    rememberApprovalGrant('/work', rule('edit', 'a.txt', 'allow'))
    assert.equal(listApprovalGrants('/work').length, 1)
  })
})

test('only allow may be remembered', () => {
  // A deny installed through the dialog would be a durable block the user never
  // wrote down or reviewed; denies belong in the configuration file.
  withStore(() => {
    assert.throws(() => rememberApprovalGrant('/work', rule('shell', 'rm *', 'deny')), /allow/)
    assert.deepEqual(listApprovalGrants('/work'), [])
  })
})

test('a configured deny outranks a saved grant', () => {
  // This is the invariant the whole ordering exists for. Appending grants after
  // the configured list under last-match-wins would let one click lift a block.
  withStore(() => {
    rememberApprovalGrant('/work', rule('shell', 'git push *', 'allow'))
    const configured = [rule('shell', 'git push *', 'deny')]
    const effect = evaluateApprovalRules({
      root: '/work',
      request: { action: 'shell', resources: ['git push origin main'] },
      configured,
      options: CI
    })
    assert.equal(effect, 'deny')
  })
})

test('a grant removes the prompt where no configured rule speaks', () => {
  withStore(() => {
    assert.equal(evaluateApprovalRules({
      root: '/work',
      request: { action: 'shell', resources: ['git status --short'] },
      configured: [],
      options: CI
    }), undefined, 'no rule must hand the decision back to the baseline')

    rememberApprovalGrant('/work', rule('shell', 'git status *', 'allow'))
    assert.equal(evaluateApprovalRules({
      root: '/work',
      request: { action: 'shell', resources: ['git status --short'] },
      configured: [],
      options: CI
    }), 'allow')
    // An unrelated command is untouched.
    assert.equal(evaluateApprovalRules({
      root: '/work',
      request: { action: 'shell', resources: ['npm install'] },
      configured: [],
      options: CI
    }), undefined)
  })
})

test('a saved command rule also covers the bare command it was offered for', () => {
  // The proposal for `git status --short` is `git status *`. If evaluation did
  // not treat a trailing " *" as optional for command text, that saved rule
  // would never match the bare form, so the feature would silently do nothing.
  withStore(() => {
    rememberApprovalGrant('/work', rule('shell', 'git status *', 'allow'))
    assert.equal(evaluateApprovalRules({
      root: '/work',
      request: { action: 'shell', resources: ['git status'] },
      configured: [],
      options: CI
    }), 'allow')
  })
})

test('a configured ask still stands when a grant does not match', () => {
  withStore(() => {
    rememberApprovalGrant('/work', rule('shell', 'git status *', 'allow'))
    const configured = [rule('shell', '*', 'ask')]
    assert.equal(evaluateApprovalRules({
      root: '/work',
      request: { action: 'shell', resources: ['npm install'] },
      configured,
      options: CI
    }), 'ask')
    assert.equal(evaluateApprovalRules({
      root: '/work',
      request: { action: 'shell', resources: ['git status'] },
      configured,
      options: CI
    }), 'allow')
  })
})

test('configured rules are read from the file and cached on mtime', () => {
  withStore((directory) => {
    assert.deepEqual(loadConfiguredApprovalRules(), [])
    writeFileSync(join(directory, CONFIGURED_RULES_FILE), JSON.stringify([
      { action: 'shell', resource: 'git push *', effect: 'deny' }
    ]), 'utf8')
    assert.deepEqual(loadConfiguredApprovalRules(), [rule('shell', 'git push *', 'deny')])
  })
})

test('a malformed configuration file fails loudly instead of dropping the deny', () => {
  // Degrading to "no rules" would be the dangerous direction: under auto/full
  // the baseline for a confined operation is "do not ask", so a typo would turn
  // a deliberate block into an automatic approval.
  withStore((directory) => {
    writeFileSync(join(directory, CONFIGURED_RULES_FILE), '{ not json', 'utf8')
    assert.throws(() => loadConfiguredApprovalRules(), /approval-rules\.json/)
    writeFileSync(join(directory, CONFIGURED_RULES_FILE), JSON.stringify([
      { action: 'shell', resource: '*', effect: 'deney' }
    ]), 'utf8')
    assert.throws(() => loadConfiguredApprovalRules(), /approval-rules\.json/)
  })
})

test('a corrupt grants file is ignored without discarding the configured rules', () => {
  withStore((directory) => {
    writeFileSync(join(directory, GRANTED_RULES_FILE), 'not json at all', 'utf8')
    assert.deepEqual(listApprovalGrants('/work'), [])
    const configured = [rule('shell', '*', 'deny')]
    assert.equal(evaluateApprovalRules({
      root: '/work',
      request: { action: 'shell', resources: ['ls'] },
      configured,
      options: CI
    }), 'deny')
  })
})
