/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareNativeCommand, runNativeCommand } from './workspaceNative.ts'
import { resetSandboxStatus, sandboxBackend, sandboxRuntimeEnv, sandboxStatus } from './workspaceSandbox.ts'

const supported = ['darwin', 'linux', 'win32'].includes(process.platform)

test('the sandbox status reflects a real child launch, not the presence of launcher files', { skip: !supported }, async (t) => {
  // The launcher may ship correctly and still refuse to start a child process. On
  // such a host the status must say so instead of claiming the backend is fine and
  // letting every command fail later with an indistinguishable exit code 1.
  resetSandboxStatus()
  const status = await sandboxStatus()
  assert.equal(status.backend, sandboxBackend())
  if (status.available) {
    assert.equal(status.reason, undefined, JSON.stringify(status))
    assert.match(status.detail, /started successfully/)
    // A claim of availability is only worth anything if a real command then works.
    // Without this, returning a hardcoded 'available: true' would pass the probe.
    const root = await mkdtemp(join(tmpdir(), 'gllm-available-'))
    try {
      const command = await prepareNativeCommand(root, 'run_shell', { code: 'echo GLLM_AVAILABLE_OK' }, [], { executionMode: 'sandbox' })
      const result = await runNativeCommand(command, {})
      assert.equal(result.exitCode, 0, result.output)
      assert.match(result.output, /GLLM_AVAILABLE_OK/)
    } finally { await rm(root, { recursive: true, force: true }) }
    return
  }
  assert.equal(status.reason, 'unverified', JSON.stringify(status))
  assert.match(status.detail, /could not start a sandboxed process/, JSON.stringify(status))
  assert.match(status.detail, /blocked rather than run without isolation/)
  t.diagnostic(`sandbox unavailable on this host: ${status.detail}`)
})

test('an unusable backend blocks commands with its own reason instead of running them unsandboxed', { skip: !supported }, async (t) => {
  resetSandboxStatus()
  if ((await sandboxStatus()).available) { t.skip('this host can start sandboxed children'); return }
  const root = await mkdtemp(join(tmpdir(), 'gllm-blocked-'))
  try {
    await writeFile(join(root, 'business.txt'), 'keep')
    const command = await prepareNativeCommand(root, 'run_shell', { code: 'echo written>escaped.txt' }, [], { executionMode: 'sandbox' })
    // A foreground call surfaces the refusal as an error, matching the path already
    // taken when the launcher is absent, so the model never sees a fake 'exit 1'.
    await assert.rejects(runNativeCommand(command, {}), (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      assert.match(message, /could not start a sandboxed process/)
      assert.match(message, /blocked rather than run without isolation/)
      return true
    })
    // The whole point: a blocked sandbox must never write through to the workspace.
    assert.deepEqual((await readdir(root)).sort(), ['business.txt'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('the probe is cached and a reset re-runs it', { skip: !supported }, async () => {
  resetSandboxStatus()
  const first = sandboxStatus()
  const second = sandboxStatus()
  assert.equal(first, second, 'concurrent callers must share one probe, not launch twice')
  const status = await first
  assert.equal(await sandboxStatus(), status, 'the settled result is served from cache')
  resetSandboxStatus()
  const third = sandboxStatus()
  assert.notEqual(third, first, 'a reset must start a new probe')
  await third
})

test('the sandbox runtime environment carries OS paths but never host business variables', () => {
  const env = sandboxRuntimeEnv('/opt/example/python')
  assert.equal((env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')[0], '/opt/example/python')
  assert.equal(env.LANG, 'en_US.UTF-8')
  // A pre-flight that inherited the host environment could pass or fail for
  // reasons the real command never sees, so secrets must never appear here.
  assert.equal(env.GLLM_TEST_SECRET, undefined)
  for (const key of Object.keys(env)) {
    assert.doesNotMatch(key, /TOKEN|SECRET|PASSWORD|KEY/i, `unexpected sensitive variable ${key}`)
  }
})

test('the pre-flight command is not reachable through runSandboxCommand', { skip: !supported }, async () => {
  // Guards the anti-recursion property: the gate depends on the probe, so the probe
  // must never call back into the gate. A regression here hangs instead of failing.
  resetSandboxStatus()
  const status = await Promise.race([
    sandboxStatus(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('sandboxStatus recursed or hung')), 120000))
  ])
  assert.equal(typeof (status as { available: boolean }).available, 'boolean')
})
