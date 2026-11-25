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
  // Two ways to be unavailable, and they mean different things: the launch really
  // failed, or the check ran out of time and proved nothing either way.
  assert.ok(status.reason === 'unverified' || status.reason === 'timeout', JSON.stringify(status))
  assert.match(status.detail, status.reason === 'unverified' ? /could not start a sandboxed process/ : /could not verify a sandboxed process/, JSON.stringify(status))
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
      // The refusal has to carry the backend's own reason: generic wording would leave
      // the user unable to tell a broken sandbox from their own command failing. It
      // cannot be compared against one captured status detail, because on a host whose
      // check times out every probe is retried and reports a different elapsed time, so
      // that snapshot never matches the refusal the command actually produced. Match the
      // stable skeleton instead -- backend name, both reason shapes, and the refusal.
      assert.match(message, /(AppContainer \+ Job Object|Seatbelt|Bubblewrap \+ seccomp) is present but could not (start|verify) a sandboxed process/, message)
      assert.match(message, /blocked rather than run without isolation/, message)
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
  if (status.reason === 'timeout') {
    // An inconclusive check is deliberately not cached, so the next command retries.
    assert.notEqual(sandboxStatus(), first, 'a timed-out check must not be cached')
    return
  }
  assert.equal(await sandboxStatus(), status, 'the settled result is served from cache')
  resetSandboxStatus()
  const third = sandboxStatus()
  assert.notEqual(third, first, 'a reset must start a new probe')
  await third
})

test('a check that times out reports uncertainty and is retried instead of cached', { skip: !supported }, async (t) => {
  // A slow first launch, cold shell startup, or an antivirus scan of the generated
  // bootstrap must not be mistaken for a broken backend: that verdict used to be
  // cached for the rest of the process, with no way to recover but a restart.
  const previous = process.env.GLLM_SANDBOX_PROBE_TIMEOUT_MS
  process.env.GLLM_SANDBOX_PROBE_TIMEOUT_MS = '1'
  try {
    resetSandboxStatus()
    const timedOut = await sandboxStatus()
    if (timedOut.available) { t.skip('this host starts a sandboxed child within 1ms'); return }
    assert.equal(timedOut.reason, 'timeout', JSON.stringify(timedOut))
    assert.match(timedOut.detail, /no result within 1ms|Execution timed out/)
    assert.match(timedOut.detail, /unknown/)
    assert.match(timedOut.detail, /blocked rather than run without isolation/)
    // Commands stay blocked, so a timeout can never become a silent host fallback.
    const root = await mkdtemp(join(tmpdir(), 'gllm-timeout-'))
    try {
      const command = await prepareNativeCommand(root, 'run_shell', { code: 'echo nope' }, [], { executionMode: 'sandbox' })
      await assert.rejects(runNativeCommand(command, {}), /blocked rather than run without isolation/)
      assert.deepEqual(await readdir(root), [], 'a timeout must not run the command unsandboxed')
    } finally { await rm(root, { recursive: true, force: true }) }
    // Budget restored, deliberately without a reset: the timeout itself must leave no
    // cached verdict behind, otherwise one slow first launch blocks the whole session.
    if (previous === undefined) delete process.env.GLLM_SANDBOX_PROBE_TIMEOUT_MS
    else process.env.GLLM_SANDBOX_PROBE_TIMEOUT_MS = previous
    const retried = await sandboxStatus()
    assert.notEqual(retried.reason, 'timeout', `the probe did not run again: ${JSON.stringify(retried)}`)
    assert.ok(retried.available || retried.reason === 'unverified', JSON.stringify(retried))
  } finally {
    if (previous === undefined) delete process.env.GLLM_SANDBOX_PROBE_TIMEOUT_MS
    else process.env.GLLM_SANDBOX_PROBE_TIMEOUT_MS = previous
    resetSandboxStatus()
  }
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
