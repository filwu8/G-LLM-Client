/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { describeToolPermission, proposeApprovalRule } from './approvalProposal.ts'

const confined = { confined: true, executionMode: 'sandbox' as const }
const proposal = (tool: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  proposeApprovalRule(describeToolPermission({ tool, args, ...extra }), { tool, ...confined })

test('a shell command proposes a command-prefix rule, not the exact invocation', () => {
  // A rule that only matched this exact invocation would re-ask on the next
  // argument, which is the friction this feature exists to remove.
  assert.deepEqual(proposal('run_shell', { purpose: 'x', code: 'git status --short' }), {
    rule: { action: 'shell', resource: 'git status *', effect: 'allow' },
    label: 'git status *'
  })
  // A command with no subcommand still proposes something usable.
  assert.equal(proposal('run_shell', { code: 'ls -la' })?.rule.resource, 'ls *')
})

test('the same proposal is produced for a command padded with whitespace', () => {
  assert.equal(
    proposal('run_shell', { code: 'git  status\t--short' })?.rule.resource,
    proposal('run_shell', { code: 'git status --short' })?.rule.resource
  )
})

test('a file edit proposes the exact path', () => {
  // Paths get no prefix treatment: `src/*` would silently widen a one-file
  // approval into a whole directory.
  assert.deepEqual(proposal('write_file', { path: 'src/a.ts' }), {
    rule: { action: 'edit', resource: 'src/a.ts', effect: 'allow' },
    label: 'src/a.ts'
  })
  assert.equal(proposal('move_file', { to: 'dest/b.txt' })?.rule.resource, 'dest/b.txt')
})

test('no proposal is offered where a rule could not be safe', () => {
  // Desktop control acts outside any workspace, so no path pattern can cover it.
  assert.equal(proposal('run_computer_command', { code: 'echo ok' }), undefined)
  assert.equal(
    proposeApprovalRule(describeToolPermission({ tool: 'browser_action', args: { url: 'https://x.test' } }), {
      tool: 'browser_action', capability: 'browser', confined: true
    }),
    undefined
  )
  // An unconfined operation can never be authorised by a rule; this is the same
  // invariant the two-axis execution policy protects.
  assert.equal(
    proposeApprovalRule(describeToolPermission({ tool: 'run_shell', args: { code: 'ls' } }), {
      tool: 'run_shell', confined: false, executionMode: 'host'
    }),
    undefined
  )
  // A script is arbitrary code: there is no stable pattern to name.
  assert.equal(proposal('run_javascript', { code: 'return 1' }), undefined)
  assert.equal(proposal('run_python', { code: 'print(1)' }), undefined)
  // Git keeps its own grant store with its own TTLs.
  assert.equal(proposal('git_write', { operation: 'fetch' }), undefined)
})

test('a call with no nameable resource proposes nothing', () => {
  assert.equal(proposal('run_shell', { code: '   ' }), undefined)
  assert.equal(proposal('write_file', {}), undefined)
  assert.equal(proposal('unknown_tool', { path: 'a.txt' }), undefined)
})

test('the tool permission vocabulary matches what the rule engine expects', () => {
  // `shell` is command text and `edit` is a path; the engine normalizes them
  // differently, so the action must not be interchangeable.
  assert.equal(describeToolPermission({ tool: 'run_shell', args: { code: 'ls' } })?.action, 'shell')
  assert.equal(describeToolPermission({ tool: 'write_file', args: { path: 'a.txt' } })?.action, 'edit')
  assert.equal(describeToolPermission({ tool: 'git_write', args: { operation: 'reset' } })?.action, 'git')
  assert.equal(describeToolPermission({ tool: 'run_javascript', args: { code: 'x()' } })?.action, 'execute')
  // A background shell job is a shell command, not a script.
  assert.equal(describeToolPermission({ tool: 'start_background', args: { language: 'shell', code: 'npm test' } })?.action, 'shell')
  assert.equal(describeToolPermission({ tool: 'start_background', args: { language: 'python', code: 'print(1)' } })?.action, 'execute')
})

test('a project check resolves the planned command, not the tool argument', () => {
  // The plan is what runs; passing it keeps the proposal honest if the check
  // planner changes what command a check maps to.
  const permission = describeToolPermission({
    tool: 'run_shell',
    args: { purpose: 'check', code: '' },
    executedCode: 'tsc --noEmit'
  })
  assert.deepEqual(permission, { action: 'shell', resource: 'tsc --noEmit' })
})
