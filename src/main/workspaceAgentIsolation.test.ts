/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

// `node:vm` isolates globals, not realms. Any host function placed inside a
// context carries the host `Function` on its `constructor` chain, so
// `tools.read_file.constructor('return process')()` reaches the real process,
// and from there `getBuiltinModule('node:fs')` reaches the whole filesystem.
// Node's own documentation states vm "is not a security mechanism" and must not
// be used to run untrusted code. A tool that evaluates model-written source in
// the main process therefore cannot be made safe by controlling what it injects
// -- only by not running it here. These assertions exist so that the boundary
// cannot be removed again without a red build.
const source = await readFile(new URL('./workspaceAgent.ts', import.meta.url), 'utf8')

test('the agent never evaluates model-written code in the main process', () => {
  // Match both `import vm from 'node:vm'` and `await import('node:vm')`.
  assert.doesNotMatch(
    source,
    /from\s+'node:vm'|import\(\s*'node:vm'\s*\)/,
    'workspaceAgent must not load node:vm: vm is documented as unsuitable for untrusted code, ' +
    'and every host function injected into a vm context leaks the host Function constructor'
  )
  // Anything that would run a source string: the three vm entry points. (A bare
  // `Script(` scan is not usable here -- meetingScript() is an unrelated helper.)
  for (const api of ['runInContext', 'runInNewContext', 'compileFunction']) {
    assert.ok(
      !source.includes(api),
      `workspaceAgent must not call vm.${api.replace('(', '')}: model-written code belongs in ` +
      'the --permission child process used by run_javascript, which enforces a filesystem allowlist'
    )
  }
})

test('no tool advertises in-process script execution', () => {
  // A tool registered under this name previously ran model code in the main
  // process while bypassing the approval pipeline (it was absent from the
  // isScript set), so it was both unapproved and able to read process.env.
  assert.doesNotMatch(
    source,
    /name: 'codemode'/,
    'codemode ran model code in the main process; batch reads belong to read_files and ' +
    'batch computation to run_javascript, which is approval-gated and sandboxed'
  )
})

test('tools that execute code stay inside the approval set', () => {
  // run_javascript shells out to a --permission child process, but that does not
  // excuse it from approval: the script still reads workspace files and its
  // purpose is model-authored. Losing this line would silently make it a
  // free-to-call tool, which is the other half of the same defect.
  assert.match(
    source,
    /const isScript = call\.function\.name === 'run_javascript'/,
    'run_javascript must remain in the isScript set so script execution keeps going through approval'
  )
})
