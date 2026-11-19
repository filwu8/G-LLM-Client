/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvalSignature,
  isRejectedOperation,
  needsWorkspaceApproval,
  workspaceApprovalInstructions
} from './workspaceAgentPolicy.ts'

/**
 * The global permission mode is an execution policy, not a security bypass: it
 * only decides how many per-call approvals the agent needs. These cases pin the
 * three documented levels so a later refactor cannot quietly widen one.
 */
test('global permission modes map to the documented approval matrix', () => {
  const cases = [
    // name, isScript, canWrite, isNative, boundary, [ask, auto, full]
    { name: 'read-only tool', script: false, write: false, native: false, boundary: {}, expected: [false, false, false] },
    { name: 'workspace file write', script: false, write: true, native: false, boundary: {}, expected: [true, false, false] },
    { name: 'restricted JavaScript', script: true, write: true, native: false, boundary: {}, expected: [true, false, false] },
    { name: 'sandboxed python/shell', script: true, write: true, native: true, boundary: { executionMode: 'sandbox' as const }, expected: [true, false, false] },
    { name: 'host python/shell', script: true, write: true, native: true, boundary: { executionMode: 'host' as const }, expected: [true, true, false] },
    { name: 'http extension tool', script: false, write: false, native: false, boundary: { external: true }, expected: [true, true, false] },
    { name: 'computer/browser tool', script: false, write: false, native: false, boundary: { desktop: true }, expected: [true, true, true] }
  ]

  for (const entry of cases) {
    const modes = ['ask', 'auto', 'full']
    modes.forEach((mode, index) => {
      assert.equal(
        needsWorkspaceApproval(mode, entry.script, entry.write, entry.native, entry.boundary),
        entry.expected[index],
        `${entry.name} under ${mode}`
      )
    })
  }
})

test('full access still asks for dedicated computer and browser tools', () => {
  // Hard boundary: relaxing the mode never grants desktop control silently.
  assert.equal(needsWorkspaceApproval('full', false, false, false, { desktop: true }), true)
  assert.equal(needsWorkspaceApproval('full', false, false, true, { executionMode: 'host' }), false)
})

test('an unknown mode degrades to the safest behaviour', () => {
  assert.equal(needsWorkspaceApproval(undefined, false, true), true)
  assert.equal(needsWorkspaceApproval('unexpected', true, true), true)
})

test('rejection signatures are stable and trim surrounding whitespace', () => {
  assert.equal(approvalSignature(' write_file ', ' a.txt '), approvalSignature('write_file', 'a.txt'))
  assert.notEqual(approvalSignature('write_file', 'a.txt'), approvalSignature('write_file', 'b.txt'))
  assert.notEqual(approvalSignature('write_file', 'a.txt'), approvalSignature('replace_text', 'a.txt'))
})

test('a rejected operation stays blocked even when the mode would allow it', () => {
  const denied = new Set([approvalSignature('run_shell', 'deploy.sh')])
  // In full mode the policy alone would let this run...
  assert.equal(needsWorkspaceApproval('full', true, true, true, { executionMode: 'host' }), false)
  // ...but the rejection ledger still forces an approval.
  assert.equal(isRejectedOperation(denied, 'run_shell', 'deploy.sh'), true)
  assert.equal(isRejectedOperation(denied, 'run_shell', 'other.sh'), false)
})

test('the runtime instruction forbids silent choices and states the live-mode rule', () => {
  for (const mode of ['ask', 'auto', 'full']) {
    const text = workspaceApprovalInstructions(mode)
    assert.match(text, /ask the user instead of choosing silently/)
    assert.match(text, /mode that is active when each tool call starts/)
    assert.match(text, /operation the user rejected stays blocked/)
    assert.match(text, /never widens?|does not enable disabled tools/)
  }
  assert.match(workspaceApprovalInstructions('full'), /Full authorization/)
  assert.match(workspaceApprovalInstructions('auto'), /Approve for me/)
  assert.match(workspaceApprovalInstructions('ask'), /Ask for approval/)
})
