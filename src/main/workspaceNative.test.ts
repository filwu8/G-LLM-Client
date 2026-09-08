/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { prepareNativeCommand, runNativeCommand } from './workspaceNative.ts'
import { runWorkspaceProcess } from './workspaceProcess.ts'

test('native commands reject unauthorized credentials and directories outside the workspace', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-native-test-'))
  try {
    await assert.rejects(prepareNativeCommand(root, 'run_shell', { code: 'pwd', cwd: '..' }, []), /inside/)
    await symlink(tmpdir(), resolve(root, 'outside'))
    await assert.rejects(prepareNativeCommand(root, 'run_shell', { code: 'pwd', cwd: 'outside' }, []), /inside/)
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

test('Python executes a business CSV calculation and creates a verified output', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-python-test-'))
  try {
    await writeFile(resolve(root, 'sales.csv'), 'customer,amount\nA,12.50\nB,7.50\n')
    const command = await prepareNativeCommand(root, 'run_python', { code: 'import csv, json\nfrom decimal import Decimal\nwith open("sales.csv") as f:\n total = sum(Decimal(row["amount"]) for row in csv.DictReader(f))\nwith open("summary.json", "w") as f:\n json.dump({"total": str(total)}, f)\nprint("created summary.json")' }, [])
    const result = await runNativeCommand(command, {})
    assert.equal(result.exitCode, 0, result.output)
    assert.deepEqual(JSON.parse(await readFile(resolve(root, 'summary.json'), 'utf8')), { total: '20.00' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Windows CMD preserves multiline code, Unicode and quoted paths in host and sandbox modes', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-shell space-&-'))
  try {
    for (const executionMode of ['host', 'sandbox'] as const) {
      const command = await prepareNativeCommand(root, 'run_shell', { code: `echo 中文结果>"中文 ${executionMode}.txt"\npython --version\necho second-line` }, [], { executionMode })
      const result = await runNativeCommand(command, {})
      assert.equal(result.exitCode, 0, result.output)
      assert.match(result.output, /Python 3\./); assert.match(result.output, /second-line/)
      assert.equal((await readFile(resolve(root, `中文 ${executionMode}.txt`), 'utf8')).trim(), '中文结果')
    }
    const failed = await runNativeCommand(await prepareNativeCommand(root, 'run_shell', { code: 'echo discard>discard.txt\nexit /b 7' }, []), {})
    assert.equal(failed.exitCode, 7, failed.output)
    await assert.rejects(readFile(resolve(root, 'discard.txt')), { code: 'ENOENT' })
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
