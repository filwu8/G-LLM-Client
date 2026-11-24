/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

// `node:vm` isolates globals, not realms. Every host function placed inside a
// context carries the host `Function` on its `constructor` chain, so
// `tools.read_file.constructor('return process')()` reaches the real process,
// and from there `getBuiltinModule('node:fs')` reaches the whole filesystem.
// Node's own documentation states vm "is not a security mechanism" and must not
// be used to run untrusted code. Neither does disabling code generation help:
// `codeGeneration: { strings: false }` only fences the context realm, while a
// host function's `constructor` is untouched.
//
// The consequence is narrow but absolute: model-written source must never be
// evaluated in the main process, no matter what is injected into the context.
// The supported route is run_javascript, which ships the source to a child
// process started with --permission plus a filesystem allowlist.
//
// These assertions exist so the boundary cannot be removed again without a red
// build. They hold on main today and are expected to fail the moment an
// in-process evaluator or an unapproved script tool is introduced.
const source = await readFile(new URL('./workspaceAgent.ts', import.meta.url), 'utf8')

test('the agent never evaluates model-written code in the main process', () => {
  // Both `import vm from 'node:vm'` and `await import('node:vm')`.
  assert.doesNotMatch(
    source,
    /from\s+'node:vm'|import\(\s*'node:vm'\s*\)/,
    'workspaceAgent must not load node:vm. vm isolates globals but not realms, so any host ' +
    'function inside the context leaks the host Function constructor and from there the real ' +
    'process. If you need to run model-written code, send it to the --permission child process ' +
    'used by run_javascript instead of evaluating it here.'
  )
  // The three vm entry points that turn a source string into running code.
  // (A bare `Script(` scan is not usable: meetingScript() is an unrelated helper.)
  for (const api of ['runInContext', 'runInNewContext', 'compileFunction']) {
    assert.ok(
      !source.includes(api),
      `workspaceAgent must not call vm.${api.replace('(', '')}. Model-written code belongs in ` +
      'the --permission child process used by run_javascript, which enforces a filesystem ' +
      'allowlist and a fixed 5-variable environment.'
    )
  }
})

test('no tool advertises in-process script execution', () => {
  // A tool registered under this name ran model code in the main process while
  // also being absent from the isScript set, so it was simultaneously
  // unapproved and able to read process.env. Batch reads belong to read_files
  // (1-32 files per call); batch computation belongs to run_javascript.
  assert.doesNotMatch(
    source,
    /name: 'codemode'/,
    'codemode evaluated model code in the main process and bypassed approval. Do not reintroduce ' +
    'it: use read_files for batch reads and run_javascript for batch computation.'
  )
})

test('tools that execute code stay inside the approval set', () => {
  // run_javascript shells out to a --permission child process, but that does not
  // excuse it from approval: the script still reads workspace files and its
  // source is model-authored. Losing this line would silently turn it into a
  // free-to-call tool, which is the other half of the same defect.
  assert.match(
    source,
    /const isScript = call\.function\.name === 'run_javascript'/,
    'run_javascript must remain in the isScript set so script execution keeps going through ' +
    'approval. A sandboxed child process limits blast radius but does not replace consent.'
  )
})
