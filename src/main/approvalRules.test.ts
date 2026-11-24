/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_PERMISSION_RULES,
  decidePermission,
  defaultCaseInsensitive,
  describePermissionRules,
  evaluatePermissionRules,
  matchesPattern,
  normalizeCommand,
  normalizePermissionRules,
  normalizeResourcePath,
  type PermissionEffect,
  type PermissionRule
} from './approvalRules.ts'

// Every assertion pins case sensitivity explicitly. The production default
// depends on the platform, and a test that inherited it would assert different
// things on Windows than on CI's Linux runner.
const CI = { caseInsensitive: false }
const CI_ON = { caseInsensitive: true }

const rule = (action: string, resource: string, effect: PermissionEffect): PermissionRule => ({ action, resource, effect })
const decide = (rules: PermissionRule[], action: string, resources: string[], options = CI) =>
  evaluatePermissionRules(rules, { action, resources }, options)

test('a later rule narrows an earlier broad one, and wins', () => {
  const rules = [
    rule('shell', '*', 'ask'),
    rule('shell', 'git status *', 'allow'),
    rule('shell', 'git push *', 'deny')
  ]
  assert.equal(decide(rules, 'shell', ['git status --porcelain']), 'allow')
  assert.equal(decide(rules, 'shell', ['git status --short']), 'allow')
  assert.equal(decide(rules, 'shell', ['git push origin main']), 'deny')
  // The broad rule still governs everything the exceptions do not name.
  assert.equal(decide(rules, 'shell', ['rm -rf /']), 'ask')
})

test('ordering is the only thing that decides, so a later allow does override a deny', () => {
  // This looks like a hole but is the documented contract: the user wrote the
  // exception last. Reversing the two rules must reverse the answer, which is
  // what proves the evaluator is order-sensitive rather than deny-biased.
  const allowLast = [rule('shell', '*', 'deny'), rule('shell', 'npm test *', 'allow')]
  const denyLast = [rule('shell', 'npm test *', 'allow'), rule('shell', '*', 'deny')]
  assert.equal(decide(allowLast, 'shell', ['npm test --silent']), 'allow')
  assert.equal(decide(denyLast, 'shell', ['npm test --silent']), 'deny')
})

test('a deny on any single resource blocks the whole operation', () => {
  // A patch touches many files. Allowing it because most of them are fine is
  // how a rule set stops meaning anything.
  const rules = [rule('edit', '*', 'allow'), rule('edit', 'secrets/*', 'deny')]
  assert.equal(decide(rules, 'edit', ['src/a.ts', 'secrets/key.pem']), 'deny')
  assert.equal(decide(rules, 'edit', ['src/a.ts', 'src/b.ts']), 'allow')
})

test('an ask on one resource is not swallowed by an allow on another', () => {
  const rules = [rule('edit', 'src/*', 'allow'), rule('edit', 'docs/*', 'ask')]
  assert.equal(decide(rules, 'edit', ['src/a.ts']), 'allow')
  assert.equal(decide(rules, 'edit', ['src/a.ts', 'docs/readme.md']), 'ask')
})

test('a resource no rule mentions is escalated, not allowed, once another resource matched', () => {
  // The bypass this closes: touch one file the rules cover with `allow`, and
  // drag an unlisted file along with it. Unlisted is unknown, and unknown must
  // not inherit the allow next to it.
  const rules = [rule('edit', 'src/a.ts', 'allow')]
  assert.equal(decide(rules, 'edit', ['src/a.ts']), 'allow')
  assert.equal(decide(rules, 'edit', ['src/a.ts', 'src/unknown.ts']), 'ask')
})

test('when no rule speaks, the evaluator stays out of the decision', () => {
  // `undefined` is the contract with the two-axis model: rules add information,
  // they do not replace the baseline. Returning 'ask' here would look safer but
  // would silently take over approval for every unconfigured operation.
  assert.equal(evaluatePermissionRules([], { action: 'shell', resources: ['ls'] }, CI), undefined)
  assert.equal(decide([rule('read', '*.md', 'allow')], 'shell', ['ls']), undefined)
  // An action mismatch alone must not produce a verdict either.
  assert.equal(decide([rule('shell', '*', 'deny')], 'read', ['a.txt']), undefined)
})

test('wildcards cover separators, and ? matches exactly one character', () => {
  assert.equal(matchesPattern('*', 'a/b/c'), true, '* must span path separators')
  assert.equal(matchesPattern('src/*', 'src/main/deep/file.ts'), true)
  assert.equal(matchesPattern('src/*', 'src'), false, '* is zero or more, but the separator is literal')
  assert.equal(matchesPattern('a?c', 'abc'), true)
  assert.equal(matchesPattern('a?c', 'ac'), false)
  assert.equal(matchesPattern('a?c', 'abbc'), false)
})

test('consecutive wildcards behave like a single one', () => {
  // Collapsed before compilation. Left alone, `.*.*` is the backtracking pair
  // that makes a long non-matching input expensive.
  assert.equal(matchesPattern('a**b', 'ab'), true)
  assert.equal(matchesPattern('a**b', 'axxxb'), true)
  assert.equal(matchesPattern('**', 'anything/at/all'), true)
})

test('regular-expression metacharacters in a pattern are literal', () => {
  // Without escaping, `a.b` would match `axb` and `(` would throw at compile.
  assert.equal(matchesPattern('a.b', 'a.b'), true)
  assert.equal(matchesPattern('a.b', 'axb'), false)
  assert.equal(matchesPattern('file(1).txt', 'file(1).txt'), true)
  assert.equal(matchesPattern('a+b', 'aab'), false)
})

test('backslash paths normalize to forward slashes before matching', () => {
  assert.equal(normalizeResourcePath('  src\\main\\index.ts \n'), 'src/main/index.ts')
  const rules = [rule('edit', 'src/*', 'allow')]
  assert.equal(decide(rules, 'edit', ['src\\main\\index.ts']), 'allow')
})

test('whitespace in command text collapses, so an extra space cannot dodge a deny', () => {
  // `rm  -rf` and `rm -rf` are the same command to the shell. A deny that only
  // matched one spelling would be bypassed by a model emitting two spaces.
  assert.equal(normalizeCommand('  rm    -rf\t/\n'), 'rm -rf /')
  const rules = [rule('shell', '*', 'ask'), rule('shell', 'rm -rf *', 'deny')]
  assert.equal(decide(rules, 'shell', ['rm  -rf  /']), 'deny')
  assert.equal(decide(rules, 'shell', ['rm   -rf\t/']), 'deny')
})

test('the trailing " *" convenience is opt-in and only applies to command text', () => {
  const shell = { ...CI, optionalTrailingArguments: true }
  assert.equal(matchesPattern('git status *', 'git status', shell), true)
  assert.equal(matchesPattern('git status *', 'git status', CI), false)
  // Paths get no such courtesy: `src/*` must never match `src` itself.
  assert.equal(matchesPattern('src/*', 'src', shell), false)
  // And an unrelated pattern shape is unaffected.
  assert.equal(matchesPattern('git *', 'git', shell), true)
})

test('case folding follows the option rather than the host platform', () => {
  assert.equal(matchesPattern('Src/*', 'src/a.ts', CI), false)
  assert.equal(matchesPattern('Src/*', 'src/a.ts', CI_ON), true)
  assert.equal(matchesPattern('GIT STATUS *', 'git status --all', CI_ON), true)
  // The production default is a platform fact, stated once and asserted as a
  // fact rather than assumed.
  assert.equal(defaultCaseInsensitive(), process.platform === 'win32')
})

test('an unknown effect is rejected, never silently dropped', () => {
  // The dangerous failure mode: dropping the rule makes the operation fall back
  // to the baseline, and under auto/full the baseline is "do not ask". A typo
  // in "deny" would then remove the protection it was meant to add.
  assert.throws(() => normalizePermissionRules([{ action: 'shell', resource: '*', effect: 'deney' }]), /effect/)
  assert.throws(() => normalizePermissionRules([{ action: 'shell', resource: '*' }]), /effect/)
  assert.throws(() => normalizePermissionRules([{ action: 'shell', resource: '*', effect: true }]), /effect/)
})

test('malformed rule lists are rejected with a position the user can act on', () => {
  assert.throws(() => normalizePermissionRules('nope'), /数组/)
  assert.throws(() => normalizePermissionRules({}), /数组/)
  assert.throws(() => normalizePermissionRules([null]), /第 1 条/)
  assert.throws(() => normalizePermissionRules([rule('shell', '*', 'allow'), []]), /第 2 条/)
  assert.throws(() => normalizePermissionRules([{ resource: '*', effect: 'allow' }]), /第 1 条.*action/)
  assert.throws(() => normalizePermissionRules([{ action: 'shell', effect: 'allow' }]), /第 1 条.*resource/)
  assert.throws(() => normalizePermissionRules([rule('shell', '   ', 'allow')]), /resource/)
  assert.throws(() => normalizePermissionRules(Array.from({ length: MAX_PERMISSION_RULES + 1 }, () => rule('*', '*', 'ask'))), /最多/)
})

test('a valid list round-trips and absent configuration means "no rules"', () => {
  assert.deepEqual(normalizePermissionRules(undefined), [])
  assert.deepEqual(normalizePermissionRules(null), [])
  assert.deepEqual(normalizePermissionRules([]), [])
  const parsed = normalizePermissionRules([
    { action: ' shell ', resource: ' git status * ', effect: 'allow', note: 'ignored on purpose' }
  ])
  assert.deepEqual(parsed, [rule('shell', 'git status *', 'allow')])
})

test('an over-long resource matches nothing instead of matching everything', () => {
  // A pattern compiles to a regexp and an unbounded input is an unbounded
  // match. Failing closed here degrades to the conservative default; failing
  // open would be a wildcard for anyone who can pad a string.
  const long = 'a'.repeat(5000)
  assert.equal(matchesPattern('*', long), false)
  assert.equal(evaluatePermissionRules([rule('shell', '*', 'allow')], { action: 'shell', resources: [long] }, CI), undefined)
})

test('an operation with no resource is refused rather than defaulted', () => {
  // "No resource" means the question was never formed. Treating it as `*` would
  // hand out a verdict the caller did not actually ask for.
  assert.throws(() => evaluatePermissionRules([rule('*', '*', 'allow')], { action: 'shell', resources: [] }, CI), /resource/)
  assert.throws(() => evaluatePermissionRules([], { action: '', resources: ['x'] }, CI), /action/)
})

test('an allow rule cannot relax an unconfined operation', () => {
  // The invariant executionPolicy.ts exists for: no approval policy can make an
  // unconfined operation safe. A rule list must not become the loophole that
  // finally does, so the unconfined guard outranks `allow`.
  for (const effect of ['allow', 'ask', undefined] as const) {
    const decision = decidePermission({ baselineNeedsApproval: false, effect, confined: false })
    assert.equal(decision.needsApproval, true, `effect=${String(effect)} must still ask when unconfined`)
    assert.equal(decision.blocked, false)
    assert.equal(decision.reason, 'unconfined')
  }
})

test('a deny still applies to an unconfined operation, because blocking is a tightening', () => {
  const decision = decidePermission({ baselineNeedsApproval: true, effect: 'deny', confined: false })
  assert.equal(decision.blocked, true)
  assert.equal(decision.needsApproval, false)
  assert.equal(decision.reason, 'deny-rule')
})

test('a confined operation lets the rule decide, and falls back to the baseline otherwise', () => {
  assert.deepEqual(decidePermission({ baselineNeedsApproval: true, effect: 'allow', confined: true }), {
    blocked: false, needsApproval: false, reason: 'allow-rule'
  })
  assert.deepEqual(decidePermission({ baselineNeedsApproval: false, effect: 'ask', confined: true }), {
    blocked: false, needsApproval: true, reason: 'ask-rule'
  })
  for (const baselineNeedsApproval of [true, false]) {
    assert.deepEqual(decidePermission({ baselineNeedsApproval, effect: undefined, confined: true }), {
      blocked: false, needsApproval: baselineNeedsApproval, reason: 'baseline'
    })
  }
})

test('the rule list can be logged without losing the order or the effects', () => {
  assert.match(describePermissionRules([]), /none configured/)
  const described = describePermissionRules([rule('shell', '*', 'ask'), rule('shell', 'git push *', 'deny')])
  assert.match(described, /shell:\*=ask/)
  assert.match(described, /shell:git push \*=deny/)
  assert.ok(described.indexOf('*=ask') < described.indexOf('git push'), 'order must survive logging')
})
