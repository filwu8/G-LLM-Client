/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Functional check of the OS sandbox the delegated engine actually runs under.
 *
 * Separate from `harnessSandbox.test.ts` on purpose: that file asserts policy
 * wiring by reading source, which is fast and platform independent. This file
 * spawns real confined processes, which proves the policy is enforced rather
 * than merely configured.
 *
 * Opt-in via `GLLM_SANDBOX_PROBE=1`, because it takes a few seconds per case
 * and, on Windows, provisions ACLs under a throwaway temp workspace. Run it
 * after upgrading the dsh runtime:
 *
 *     GLLM_SANDBOX_PROBE=1 node --test --experimental-strip-types \
 *       src/main/harnessSandboxEnforcement.test.ts
 *
 * On any platform without the windows-acl runner the file skips: the point is
 * to confirm the backend dsh would select here, not to test other backends.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectHarnessRuntime } from './workspaceHarness.ts'

const enabled = process.env.GLLM_SANDBOX_PROBE === '1'
const skip = !enabled
  ? 'set GLLM_SANDBOX_PROBE=1 to run the functional sandbox check'
  : process.platform !== 'win32'
    ? 'the windows-acl runner only exists on Windows; other platforms use bwrap or Seatbelt'
    : false

function runnerPath(): string | undefined {
  const runtime = inspectHarnessRuntime()
  if (!runtime.available || !runtime.runtimeDir) return undefined
  // Both separators: the runtime dir is reported with the host's own, and the
  // path is assembled here rather than resolved through package exports so the
  // check works without importing the dsh package graph.
  for (const sep of ['/', '\\']) {
    const candidate = join(runtime.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js')
    if (existsSync(candidate)) return candidate
    void sep
  }
  return undefined
}

function nodePath(): string {
  const runtime = inspectHarnessRuntime()
  return runtime.nodePath ?? process.execPath
}

/**
 * Run one snippet inside the real runner under the given mode.
 *
 * `node -e` is the confined program rather than a shell: it keeps the check
 * independent of shell quoting and, unlike cmd.exe, is a plain child process
 * the restricted token can start.
 */
function confined(runner: string, workspace: string, mode: 'read-only' | 'workspace-write', code: string) {
  const result = spawnSync(nodePath(), [runner,
    '--workspace', workspace,
    '--temp', tmpdir(),
    '--mode', mode,
    '--', nodePath(), '-e', code
  ], { encoding: 'utf8', timeout: 120000 })
  return { status: result.status, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() }
}

const writeInside = (path: string) =>
  `try { require('node:fs').writeFileSync(${JSON.stringify(path)}, 'ok'); console.log('WROTE') } catch (error) { console.log('DENIED:' + error.code) }`

test('the sandbox the engine runs under really confines writes', { skip }, () => {
  const runner = runnerPath()
  assert.ok(runner, 'the windows-acl runner must be present in the prepared runtime')

  // A throwaway workspace: provisioning writes ACLs, and the probe must never
  // touch the project tree.
  const workspace = mkdtempSync(join(tmpdir(), 'gllm-sbx-'))
  const inside = join(workspace, 'inside.txt')
  const outside = join(tmpdir(), `gllm-sbx-escape-${process.pid}.txt`)
  try {
    // 1. Under workspace-write, an in-workspace write must land. This is the
    //    capability the delegated engine needs to do any work at all.
    const landed = confined(runner, workspace, 'workspace-write', writeInside(inside))
    assert.equal(landed.status, 0, `runner failed: ${landed.stderr}`)
    assert.equal(landed.stdout, 'WROTE', `in-workspace write was refused: ${landed.stdout}${landed.stderr}`)
    assert.equal(existsSync(inside), true, 'the confined process reported success but wrote nothing')

    // 2. The same mode must refuse a write outside the workspace. If this ever
    //    passes, the confinement is decorative.
    const escaped = confined(runner, workspace, 'workspace-write', writeInside(outside))
    assert.equal(escaped.status, 0, `runner failed: ${escaped.stderr}`)
    assert.match(escaped.stdout, /^DENIED:/, `a write outside the workspace was allowed: ${escaped.stdout}`)
    assert.equal(existsSync(outside), false, 'a write outside the workspace reached the filesystem')

    // 3. read-only must refuse even an in-workspace write, otherwise the
    //    read-only setting would be indistinguishable from workspace-write.
    const readOnlyTarget = join(workspace, 'readonly.txt')
    const refused = confined(runner, workspace, 'read-only', writeInside(readOnlyTarget))
    assert.equal(refused.status, 0, `runner failed: ${refused.stderr}`)
    assert.match(refused.stdout, /^DENIED:/, `read-only allowed a write: ${refused.stdout}`)
    assert.equal(existsSync(readOnlyTarget), false, 'read-only mode wrote a file')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(outside, { force: true })
  }
})
