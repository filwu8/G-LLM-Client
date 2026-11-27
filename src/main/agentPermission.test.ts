/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvalSignature,
  commandIdentity,
  isRejectedOperation,
  needsWorkspaceApproval,
  resolveApprovalTarget,
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
    { name: 'host python/shell', script: true, write: true, native: true, boundary: { executionMode: 'host' as const }, expected: [true, true, true] },
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

test('full access still asks for dedicated computer, browser and host execution tools', () => {
  // Hard write boundary: relaxing the mode never grants desktop control or
  // unsandboxed host execution silently, because both can touch files outside
  // the authorized workspace.
  assert.equal(needsWorkspaceApproval('full', false, false, false, { desktop: true }), true)
  assert.equal(needsWorkspaceApproval('full', false, false, true, { executionMode: 'host' }), true)
  assert.equal(needsWorkspaceApproval('full', true, true, true, { executionMode: 'sandbox' }), false)
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
  // Sandboxed shell in full mode would be allowed by policy alone...
  assert.equal(needsWorkspaceApproval('full', true, true, true, { executionMode: 'sandbox' }), false)
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

test('a shell command keeps an identity of its own', () => {
  const target = (code: string) => resolveApprovalTarget('run_shell', { purpose: 'inspect', code })
  // The regression this fixes: `run_shell` takes `code`, never `path`, so the
  // old path-only resolution returned '' for every command. Both commands then
  // shared the constant signature `run_shell:`, and one rejection forced an
  // approval prompt on every later command in the task -- `ls` included.
  assert.notEqual(target('npm install left-pad'), target('ls -la'))
  assert.notEqual(target('npm install left-pad'), '')
  assert.notEqual(target('ls -la'), '')
  // Same command, different whitespace: the same operation. Whitespace is
  // collapsed before tokenizing, and that ordering matters: without it
  // `rm  -rf build` tokenizes to [rm, "", -rf, build] and resolves to `rm`
  // while `rm -rf build` resolves to `rm build`, so one command would carry
  // two identities and a rejection could be dodged with an extra space.
  assert.equal(target('npm install  left-pad'), target('npm install left-pad'))
  assert.equal(target('rm  -rf build'), target('rm -rf build'))
  assert.equal(target('npm\tinstall\tleft-pad'), target('npm install left-pad'))
  assert.equal(target('npm\ninstall left-pad'), target('npm install left-pad'))
  // A padded argument must not mint a new identity, or a rejection is one
  // extra flag away from being bypassed.
  assert.equal(target('git status --short'), target('git status'))
  assert.equal(target('rm -rf build'), target('rm build'))
  assert.equal(target('ls -la'), target('ls'))
})

test('a script is identified by its own text, not by the tool that runs it', () => {
  const target = (code: string) => resolveApprovalTarget('run_javascript', { purpose: 'x', code })
  assert.equal(target('return 1'), target('return 1'))
  assert.notEqual(target('return 1'), target('return 2'))
  // Reformatting line endings is not a different operation.
  assert.equal(target('a()\r\nb()'), target('a()\nb()'))
  assert.equal(target('  return 1  '), target('return 1'))
  assert.match(target('return 1'), /^script:[0-9a-f]{16}$/)
  // The digest keeps model-authored code out of the checkpoint file, which is
  // plain JSON on disk.
  assert.ok(!target('const secret = 1').includes('secret'))
})

test('background jobs inherit the identity of what they will run', () => {
  const shell = resolveApprovalTarget('start_background', { language: 'shell', code: 'npm run build' })
  const python = resolveApprovalTarget('start_background', { language: 'python', code: 'print(1)' })
  assert.equal(shell, commandIdentity('npm run build'))
  assert.match(python, /^script:/)
})

test('a tool whose identity is a path keeps resolving to that path', () => {
  assert.equal(resolveApprovalTarget('write_file', { path: ' src/a.ts ' }), 'src/a.ts')
  assert.equal(resolveApprovalTarget('create_docx', { output: 'out.docx' }), 'out.docx')
  assert.equal(resolveApprovalTarget('move_file', { to: 'dest/b.txt' }), 'dest/b.txt')
  // Git approvals stay scoped per repository and path filter, and every part
  // stays distinct.
  assert.equal(resolveApprovalTarget('git_write', { operation: 'reset', repo: 'sub', path: 'src' }), 'reset│sub│src')
  assert.notEqual(resolveApprovalTarget('git_write', { operation: 'reset', repo: 'a' }), resolveApprovalTarget('git_write', { operation: 'reset', repo: 'b' }))
  // The operation is part of the identity: a declined push must not gate the
  // commit that produces it, and a declined reset must not gate a checkout.
  assert.notEqual(resolveApprovalTarget('git_write', { operation: 'push', repo: 'a' }), resolveApprovalTarget('git_write', { operation: 'commit', repo: 'a' }))
  assert.notEqual(resolveApprovalTarget('git_write', { operation: 'reset', repo: 'a' }), resolveApprovalTarget('git_write', { operation: 'checkout', repo: 'a' }))
})

test('a project check is identified by the check, not by the planned command', () => {
  // The plan is derived and could change with the toolchain; the user approves
  // the check they asked for.
  const target = resolveApprovalTarget('run_project_check', { check: 'typecheck' }, 'tsc --noEmit')
  assert.equal(target, 'check:typecheck')
})

test('command identity is never empty for a command-bearing tool', () => {
  // An empty identity is what created the bug: it made every invocation of the
  // tool indistinguishable in the rejection ledger.
  for (const tool of ['run_shell', 'run_computer_command']) {
    assert.notEqual(resolveApprovalTarget(tool, { code: ' whoami ' }), '', tool)
  }
  for (const tool of ['run_javascript', 'run_python']) {
    assert.notEqual(resolveApprovalTarget(tool, { code: 'x()' }), '', tool)
  }
})
