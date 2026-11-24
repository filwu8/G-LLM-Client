/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { appendToolHookNotes, permissionFileGuard, runAfterToolHooks, runBeforeToolHooks, type ToolHook, type ToolHookContext } from './toolHooks.ts'

function context(overrides: Partial<ToolHookContext> = {}): ToolHookContext {
  return {
    tool: 'write_file',
    args: { path: 'src/app.ts' },
    workspaceRoot: 'C:\\work\\alpha',
    runId: 'run-1',
    ...overrides
  }
}

test('before hooks run in registration order and collect their notes', () => {
  const order: string[] = []
  const hooks: ToolHook[] = [
    { id: 'first', before: () => { order.push('first'); return { note: 'one' } } },
    { id: 'second', before: () => { order.push('second'); return { note: 'two' } } },
    { id: 'no-before', after: () => ({ note: 'never in this phase' }) }
  ]
  const result = runBeforeToolHooks(hooks, context())
  assert.deepEqual(order, ['first', 'second'])
  assert.equal(result.block, undefined)
  assert.deepEqual(result.notes, ['one', 'two'])
})

test('the first veto stops the remaining before hooks', () => {
  const order: string[] = []
  const hooks: ToolHook[] = [
    { id: 'first', before: () => { order.push('first'); return { note: 'checked' } } },
    { id: 'second', before: () => { order.push('second'); return { block: 'nope' } } },
    { id: 'third', before: () => { order.push('third') } }
  ]
  const result = runBeforeToolHooks(hooks, context())
  assert.equal(result.block, 'nope')
  // Policy checks are not run against a call that will never execute.
  assert.deepEqual(order, ['first', 'second'])
  // A note earned before the veto is still reported.
  assert.deepEqual(result.notes, ['checked'])
})

test('a throwing before hook refuses the call instead of waving it through', () => {
  const hooks: ToolHook[] = [
    { id: 'broken-policy', before: () => { throw new Error('missing rule table') } },
    { id: 'never-reached', before: () => { throw new Error('should not run after a veto') } }
  ]
  const result = runBeforeToolHooks(hooks, context())
  assert.ok(result.block)
  assert.match(result.block, /broken-policy/)
  assert.match(result.block, /missing rule table/)
  // The reason has to say the operation did not run: the model must not retry
  // believing a side effect happened, and must not assume it was approved.
  assert.match(result.block, /Nothing was executed/)
})

test('an empty hook list is not an error and reports no notes', () => {
  const result = runBeforeToolHooks([], context())
  assert.equal(result.block, undefined)
  assert.deepEqual(result.notes, [])
})

test('after hooks run in order and collect their notes', () => {
  const order: string[] = []
  const hooks: ToolHook[] = [
    { id: 'first', after: (_context, outcome) => { order.push(`first:${outcome.exitCode}`); return { note: 'one' } } },
    { id: 'second', after: () => { order.push('second'); return { note: 'two' } } }
  ]
  const result = runAfterToolHooks(hooks, context(), { output: 'done', exitCode: 0 })
  assert.deepEqual(order, ['first:0', 'second'])
  assert.deepEqual(result.notes, ['one', 'two'])
})

test('a throwing after hook is swallowed and the remaining hooks still run', () => {
  const order: string[] = []
  const hooks: ToolHook[] = [
    { id: 'broken-observer', after: () => { throw new Error('telemetry offline') } },
    { id: 'second', after: () => { order.push('second'); return { note: 'survived' } } }
  ]
  const result = runAfterToolHooks(hooks, context(), { output: 'done' })
  // The side effect already happened: a broken observer must not turn a
  // successful call into a failed one.
  assert.deepEqual(order, ['second'])
  assert.deepEqual(result.notes, ['survived'])
})

test('an after hook cannot veto', () => {
  // Cast through unknown: the type already forbids `block`, and this asserts the
  // runtime keeps that promise for code that ignores the type.
  const hooks = [{ id: 'sneaky', after: () => ({ note: 'observed', block: 'too late' }) }] as unknown as ToolHook[]
  const result = runAfterToolHooks(hooks, context(), { output: 'done' })
  assert.equal('block' in result, false)
  assert.deepEqual(result.notes, ['observed'])
})

test('a result with no notes is returned byte for byte', () => {
  assert.equal(appendToolHookNotes('ok', []), 'ok')
  assert.equal(appendToolHookNotes('', []), '')
})

test('notes are appended below the result, one per line, under a marker', () => {
  const output = appendToolHookNotes('line 1', ['first', 'second'])
  assert.equal(output, 'line 1\n\n[hook] first\n[hook] second')
})

test('the permission-file guard blocks a write to the rules file', () => {
  const verdict = permissionFileGuard.before?.(context({ args: { path: 'C:\\Users\\dev\\AppData\\g-llm\\approval-rules.json' } }))
  assert.ok(verdict?.block)
  assert.match(verdict.block, /approval-rules\.json/)
  assert.match(verdict.block, /may not read or rewrite/)
})

test('the guard matches the file name in any position and any case', () => {
  const subdirectory = permissionFileGuard.before?.(context({ args: { output: 'config/approval-grants.json' } }))
  assert.ok(subdirectory?.block)
  const mixedCase = permissionFileGuard.before?.(context({ args: { to: 'Approval-Grants.JSON' } }))
  assert.ok(mixedCase?.block, 'a Windows file name comparison must not be case sensitive')
  const backslash = permissionFileGuard.before?.(context({ args: { file: 'a\\b\\approval-rules.json' } }))
  assert.ok(backslash?.block)
})

test('the guard leaves ordinary paths alone', () => {
  for (const path of ['src/app.ts', 'docs/approval-rules.md', 'approval-rules.json.bak', 'approval-rules.json/keep.txt', '']) {
    assert.equal(permissionFileGuard.before?.(context({ args: { path } })), undefined, path)
  }
  // A tool whose path argument is not a string is not this hook's business.
  assert.equal(permissionFileGuard.before?.(context({ args: { path: 42 } })), undefined)
})

test('the guard ignores prose and shell source that merely name the files', () => {
  // Deliberate: scanning free text would block this repository's own docs and
  // tests. Reaching those paths from a shell is the sandbox's job.
  assert.equal(permissionFileGuard.before?.(context({
    tool: 'delegate_to_harness',
    args: { task: 'explain what approval-rules.json does' }
  })), undefined)
  assert.equal(permissionFileGuard.before?.(context({
    tool: 'run_shell',
    args: { purpose: 'inspect', code: 'cat ~/.config/g-llm/approval-grants.json' }
  })), undefined)
})
