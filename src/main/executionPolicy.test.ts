/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allowsOperation,
  boundaryFromTool,
  describeExecutionPolicy,
  isWidening,
  narrowSandboxMode,
  normalizeApprovalPolicy,
  normalizeSandboxMode,
  requiresApproval,
  resolveExecutionPolicy
} from './executionPolicy.ts'

const policy = (sandbox: 'read-only' | 'workspace-write' | 'danger-full-access', approval: 'ask' | 'auto' | 'full') => ({ sandbox, approval })

test('unknown input collapses to the tightest policy instead of the loosest', () => {
  // A saved state from an older build, a hand-edited config, or a value a newer
  // version invented must never widen confinement by accident.
  for (const value of [undefined, null, '', 'readonly', 'full-access', 0, {}, []]) {
    assert.equal(normalizeSandboxMode(value), 'read-only', `sandbox: ${String(value)}`)
    assert.equal(normalizeApprovalPolicy(value), 'ask', `approval: ${String(value)}`)
  }
  // Known values survive unchanged.
  for (const value of ['read-only', 'workspace-write', 'danger-full-access'] as const) {
    assert.equal(normalizeSandboxMode(value), value)
  }
  for (const value of ['ask', 'auto', 'full'] as const) {
    assert.equal(normalizeApprovalPolicy(value), value)
  }
})

test('an unconfined operation is never auto-approved, whatever the approval policy says', () => {
  // The whole point of keeping sandbox and approval on separate axes: no
  // approval setting can make an unconfined operation safe.
  for (const approval of ['ask', 'auto', 'full'] as const) {
    assert.equal(
      requiresApproval(policy('danger-full-access', approval), { kind: 'code', confinement: 'danger-full-access' }),
      true,
      `approval=${approval} must not waive an unconfined operation`
    )
  }
})

test('an unstated boundary is treated as unconfined, not as safe', () => {
  // Callers must prove confinement. Defaulting an absent field to
  // workspace-write would turn a forgotten argument into a silent auto-approve.
  assert.equal(requiresApproval(policy('workspace-write', 'full'), { kind: 'code' }), true)
  assert.equal(requiresApproval(policy('workspace-write', 'auto'), { kind: 'write' }), true)
})

test('confined operations follow the approval policy on the approval axis alone', () => {
  const confined = (kind: 'read' | 'write' | 'code' | 'network') => ({ kind, confinement: 'workspace-write' as const })
  const table = [
    { kind: 'read' as const, expected: [false, false, false] },
    { kind: 'write' as const, expected: [true, false, false] },
    { kind: 'code' as const, expected: [true, false, false] },
    { kind: 'network' as const, expected: [true, true, false] }
  ]
  for (const entry of table) {
    for (const [index, approval] of (['ask', 'auto', 'full'] as const).entries()) {
      assert.equal(
        requiresApproval(policy('workspace-write', approval), confined(entry.kind)),
        entry.expected[index],
        `${approval}: ${entry.kind}`
      )
    }
  }
})

test('desktop control asks in every mode, including full and read-only', () => {
  for (const sandbox of ['read-only', 'workspace-write', 'danger-full-access'] as const) {
    for (const approval of ['ask', 'auto', 'full'] as const) {
      assert.equal(requiresApproval(policy(sandbox, approval), { kind: 'desktop' }), true, `${sandbox}/${approval}`)
    }
  }
})

test('the boundary derivation matches the dispatcher facts it is fed', () => {
  // Desktop wins over every other capability: it is the one that acts outside
  // the filesystem entirely.
  assert.deepEqual(boundaryFromTool({ desktop: true, external: true, isScript: true }), { kind: 'desktop', confinement: 'workspace-write' })
  assert.deepEqual(boundaryFromTool({ external: true, isScript: true, canWrite: true }), { kind: 'network', confinement: 'workspace-write' })
  assert.deepEqual(boundaryFromTool({ isScript: true, canWrite: true }), { kind: 'code', confinement: 'workspace-write' })
  assert.deepEqual(boundaryFromTool({ canWrite: true }), { kind: 'write', confinement: 'workspace-write' })
  assert.deepEqual(boundaryFromTool({}), { kind: 'read', confinement: 'workspace-write' })
  // Native sandbox jobs are still confined; host jobs are not.
  assert.deepEqual(boundaryFromTool({ isScript: true, canWrite: true, isNative: true, executionMode: 'sandbox' }), { kind: 'code', confinement: 'workspace-write' })
  assert.deepEqual(boundaryFromTool({ isScript: true, canWrite: true, isNative: true, executionMode: 'host' }), { kind: 'code', confinement: 'danger-full-access' })
  // A native job whose execution mode was never stated is not assumed confined.
  assert.deepEqual(boundaryFromTool({ isScript: true, canWrite: true, isNative: true }), { kind: 'code', confinement: 'danger-full-access' })
})

test('a policy merge may narrow confinement but never widen it', () => {
  assert.equal(isWidening('workspace-write', 'danger-full-access'), true)
  assert.equal(isWidening('read-only', 'workspace-write'), true)
  assert.equal(isWidening('danger-full-access', 'workspace-write'), false)
  assert.equal(isWidening('workspace-write', 'workspace-write'), false)
  // Symmetric narrowing: neither argument order can produce a wider result.
  for (const a of ['read-only', 'workspace-write', 'danger-full-access'] as const) {
    for (const b of ['read-only', 'workspace-write', 'danger-full-access'] as const) {
      assert.equal(narrowSandboxMode(a, b), narrowSandboxMode(b, a))
      assert.equal(isWidening(a, narrowSandboxMode(a, b)), false, `${a} narrowed by ${b} must not widen`)
    }
  }
})

test('read-only confinement refuses writes rather than prompting for them', () => {
  // A refusal is the right answer here: the fix is to narrow the request, not
  // to ask the user to widen the sandbox for every write.
  assert.equal(allowsOperation('read-only', 'read'), true)
  assert.equal(allowsOperation('read-only', 'write'), false)
  assert.equal(allowsOperation('read-only', 'code'), false)
  assert.equal(allowsOperation('read-only', 'network'), false)
  for (const kind of ['read', 'write', 'code', 'network', 'desktop'] as const) {
    assert.equal(allowsOperation('danger-full-access', kind), true, `full access must permit ${kind}`)
  }
  assert.equal(allowsOperation('workspace-write', 'network'), true)
  assert.equal(allowsOperation('workspace-write', 'desktop'), false)
})

test('the policy description names both axes so a log cannot hide one', () => {
  assert.match(describeExecutionPolicy(policy('read-only', 'ask')), /sandbox=read-only/)
  assert.match(describeExecutionPolicy(policy('read-only', 'ask')), /approval=ask/)
  assert.match(describeExecutionPolicy(resolveExecutionPolicy('workspace-write', 'auto')), /approval=auto/)
  assert.match(describeExecutionPolicy(policy('danger-full-access', 'full')), /unconfined/)
})
