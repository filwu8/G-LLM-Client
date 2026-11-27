/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { friendlyScriptError, SCRIPT_WORKSPACE_METHODS } from './workspaceScriptErrors.ts'

// Observed in a real run: the tool description listed the sandbox API without
// its object, so the model wrote `await readText('package.json')`. The client
// answered "this capability is not available" — false, it is right there as
// workspace.readText — and the model spent its next two calls looking for a
// workaround. The message must name the real spelling.
test('a bare workspace call is answered with the correct spelling', () => {
  const raw = 'ReferenceError: readText is not defined\n    at gllm-workspace-script.js:2:1'
  const zh = friendlyScriptError(raw, false)
  assert.match(zh, /workspace\.readText/)
  assert.doesNotMatch(zh, /尚未提供/)
  assert.match(friendlyScriptError(raw, true), /workspace\.readText/)

  for (const method of ['readText', 'writeText', 'list', 'stat', 'mkdir']) {
    assert.ok(SCRIPT_WORKSPACE_METHODS.includes(method), `${method} must be recognised`)
    assert.match(friendlyScriptError(`ReferenceError: ${method} is not defined`, false), new RegExp(`workspace\\.${method}`))
  }
})

test('an unknown global keeps the compatibility explanation', () => {
  // Still true for things the sandbox really does not have (require, process).
  const zh = friendlyScriptError('ReferenceError: require is not defined', false)
  assert.match(zh, /尚未提供/)
  assert.match(friendlyScriptError('ReferenceError: require is not defined', true), /not available/)
})

// The model hit this second: after the first failure it tried to build the test
// case with new Function, which the isolated context forbids. "Code generation
// from strings disallowed" alone gives it nothing to change.
test('runtime code generation explains what to do instead', () => {
  const raw = 'EvalError: Code generation from strings disallowed for this context\n    at new Function (<anonymous>)'
  assert.match(friendlyScriptError(raw, false), /eval 或 new Function/)
  assert.match(friendlyScriptError(raw, true), /eval or new Function/)
})

test('everything else still surfaces the first real line', () => {
  assert.equal(friendlyScriptError('Error: ENOENT: no such file or directory, open \'x.txt\'', false), "ENOENT: no such file or directory, open 'x.txt'")
  assert.equal(friendlyScriptError('   \n\n', false), '临时脚本运行失败')
  assert.equal(friendlyScriptError('', true), 'The temporary script failed')
})
