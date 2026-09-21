/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { nativeExecutionLanguages, prepareNativeCommand, probeNativePython, runNativeCommand } from './workspaceNative.ts'
import { runWorkspaceProcess } from './workspaceProcess.ts'

test('Python is offered only when the selected execution mode can actually launch it', async () => {
  const available = await probeNativePython({ executionMode: 'sandbox' })
  assert.deepEqual(nativeExecutionLanguages(available), available ? ['python', 'shell'] : ['shell'])
  assert.deepEqual(nativeExecutionLanguages(false), ['shell'])
})

test('native commands reject unauthorized credentials and directories outside the workspace', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-native-test-'))
  try {
    await assert.rejects(prepareNativeCommand(root, 'run_shell', { code: 'pwd', cwd: '..' }, []), /inside/)
    try {
      await symlink(tmpdir(), resolve(root, 'outside'))
      await assert.rejects(prepareNativeCommand(root, 'run_shell', { code: 'pwd', cwd: 'outside' }, []), /inside/)
    } catch (error) {
      if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    }
    await assert.rejects(prepareNativeCommand(root, 'run_python', { code: 'print(1)', envNames: ['TOKEN'] }, []), /not been enabled/)
    await assert.rejects(prepareNativeCommand(root, 'run_shell', { code: 'pwd', envNames: ['NOT VALID'] }, []), /Invalid/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('host shell uses selected environment only and redacts literal secrets', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-native-test-'))
  const previous = process.env.GLLM_TEST_PARENT_SECRET
  process.env.GLLM_TEST_PARENT_SECRET = 'must-not-be-inherited'
  try {
    const command = await prepareNativeCommand(root, 'run_shell', { code: 'printf "%s\\n" "$TOKEN" "${GLLM_TEST_PARENT_SECRET-unset}"; printf done > result.txt', envNames: ['TOKEN'] }, ['TOKEN'], { executionMode: 'host' })
    const result = await runNativeCommand(command, { TOKEN: 'private-fixture-token' })
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /REDACTED/)
    assert.match(result.output, /unset/)
    assert.doesNotMatch(result.output, /private-fixture-token|must-not-be-inherited/)
    assert.equal(await readFile(resolve(root, 'result.txt'), 'utf8'), 'done')
    const failed = await runNativeCommand({ ...command, code: 'exit 7' }, { TOKEN: 'private-fixture-token' })
    assert.equal(failed.exitCode, 7)
  } finally {
    if (previous === undefined) delete process.env.GLLM_TEST_PARENT_SECRET
    else process.env.GLLM_TEST_PARENT_SECRET = previous
    await rm(root, { recursive: true, force: true })
  }
})

test('Python executes a business CSV calculation and creates a verified output', async (t) => {
  if (!await probeNativePython({ executionMode: 'sandbox' })) { t.skip('Python is not runnable in the selected sandbox'); return }
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-python-test-'))
  try {
    await writeFile(resolve(root, 'sales.csv'), 'customer,amount\nA,12.50\nB,7.50\n')
    const command = await prepareNativeCommand(root, 'run_python', { code: 'import csv, json\nfrom decimal import Decimal\nwith open("sales.csv") as f:\n total = sum(Decimal(row["amount"]) for row in csv.DictReader(f))\nwith open("summary.json", "w") as f:\n json.dump({"total": str(total)}, f)\nprint("created summary.json · 完成")' }, [])
    const result = await runNativeCommand(command, {})
    assert.equal(result.exitCode, 0, result.output)
    assert.deepEqual(JSON.parse(await readFile(resolve(root, 'summary.json'), 'utf8')), { total: '20.00' })
    assert.match(result.output, /完成/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Windows CMD preserves multiline code, Unicode and quoted paths in host and sandbox modes', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-shell space-&-'))
  try {
    for (const executionMode of ['host', 'sandbox'] as const) {
      const command = await prepareNativeCommand(root, 'run_shell', { code: `echo 中文结果>"中文 ${executionMode}.txt"\necho shell-ready\necho second-line` }, [], { executionMode })
      const result = await runNativeCommand(command, {})
      assert.equal(result.exitCode, 0, result.output)
      assert.match(result.output, /shell-ready/); assert.match(result.output, /second-line/)
      assert.ok((await readdir(root)).includes(`中文 ${executionMode}.txt`), JSON.stringify({ output: result.output, files: await readdir(root) }))
      assert.equal((await readFile(resolve(root, `中文 ${executionMode}.txt`), 'utf8')).trim(), '中文结果')
    }
    const failed = await runNativeCommand(await prepareNativeCommand(root, 'run_shell', { code: 'echo discard>discard.txt\nexit /b 7' }, []), {})
    assert.equal(failed.exitCode, 7, failed.output)
    await assert.rejects(readFile(resolve(root, 'discard.txt')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Windows sandbox keeps Chinese failure output readable and preserves the process exit code', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-shell-unicode-error-'))
  try {
    const result = await runNativeCommand(await prepareNativeCommand(root, 'run_shell', { code: 'echo 中文命令失败 1>&2\nexit /b 7' }, [], { executionMode: 'sandbox' }), {})
    assert.equal(result.exitCode, 7, result.output)
    assert.match(result.output, /中文命令失败/)
    assert.doesNotMatch(result.output, /�|#< CLIXML/)
    assert.match(result.output, /No host fallback was attempted/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Windows CMD gives actionable guidance for unsupported POSIX commands', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-shell-guidance-'))
  try {
    const unsupported = await runNativeCommand(await prepareNativeCommand(root, 'run_shell', { code: 'head -n 1 missing.txt' }, [], { executionMode: 'sandbox' }), {})
    assert.notEqual(unsupported.exitCode, 0)
    assert.match(unsupported.output, /Windows shell note: run_shell uses CMD batch syntax/)
    assert.match(unsupported.output, /run_javascript/)
    assert.doesNotMatch(unsupported.output, /#< CLIXML/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('managed processes stop on timeout, output overflow and pre-cancellation', async () => {
  const base = { executable: process.execPath, cwd: tmpdir(), env: {}, args: ['-e', 'setInterval(()=>{},1000)'] }
  await assert.rejects(runWorkspaceProcess({ ...base, timeoutMs: 100 }), /timed out/)
  await assert.rejects(runWorkspaceProcess({ ...base, args: ['-e', 'console.log("x".repeat(10000))'], maxOutputBytes: 100 }), /output exceeded/)
  const controller = new AbortController()
  controller.abort()
  assert.throws(() => runWorkspaceProcess({ ...base, signal: controller.signal }), { name: 'AbortError' })
})

test('cancellation kills ordinary descendants before they can write', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-cancel-test-'))
  const controller = new AbortController()
  try {
    const pending = runWorkspaceProcess({ executable: '/bin/sh', args: ['-c', '(sleep 1; printf escaped > child.txt) & wait'], cwd: root, env: {}, signal: controller.signal })
    const timer = setTimeout(() => controller.abort(), 150)
    await assert.rejects(pending, { name: 'AbortError' })
    clearTimeout(timer)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1100))
    await assert.rejects(readFile(resolve(root, 'child.txt')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
