/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { harnessHomeFor } from './workspaceHarness.ts'

const bridgeSource = await readFile(new URL('../../resources/harness-bridge.mjs', import.meta.url), 'utf8')
const agentSource = await readFile(new URL('./workspaceAgent.ts', import.meta.url), 'utf8')

test('the Harness home never lives inside the workspace it serves', () => {
  // dsh applies `$DSH_HOME/cordis.patch.yml` as a user layer before the
  // profile. A home directory inside the project would let repository contents
  // rewrite the sandbox policy that is supposed to govern the run.
  const workspace = join(tmpdir(), 'gllm-harness-home-probe')
  const home = harnessHomeFor(workspace)
  assert.equal(
    resolve(home).startsWith(resolve(workspace)),
    false,
    `Harness home ${home} must not sit under workspace ${workspace}`
  )
})

test('the Harness home is stable per workspace and distinct across workspaces', () => {
  const first = join(tmpdir(), 'gllm-ws-one')
  const second = join(tmpdir(), 'gllm-ws-two')
  assert.equal(harnessHomeFor(first), harnessHomeFor(first))
  assert.notEqual(harnessHomeFor(first), harnessHomeFor(second))
})

test('the Harness home is case-insensitive on Windows so one project keeps one history', { skip: process.platform !== 'win32' }, () => {
  const path = join(tmpdir(), 'GLLM-Case-Probe')
  assert.equal(harnessHomeFor(path), harnessHomeFor(path.toLowerCase()))
})

test('the bridge pins a confined sandbox instead of inheriting the profile default', () => {
  // The shipped `sdk-minimal` profile sets danger-full-access, which is the
  // opposite of dsh's own read-only fail-safe. A bridge that never writes this
  // patch inherits an unconfined shell and loses the protection silently.
  assert.match(bridgeSource, /DEFAULT_SANDBOX_MODE = 'workspace-write'/, 'the fallback must stay confined')
  assert.match(bridgeSource, /SANDBOX_MODES\.includes\(sandboxMode\) \? sandboxMode : DEFAULT_SANDBOX_MODE/, 'an unrecognised mode must fall back to the confined default')
  assert.match(bridgeSource, /- id: sandbox-policy/, 'the patch must override the profile policy')
  assert.match(bridgeSource, /mode: \$\{mode\}/, 'the patch must carry the resolved mode')
})

test('the bridge mounts an approval seam because the profile ships without one', () => {
  // Without ctx.approval the enforcement points have nowhere to ask, so any
  // escalation silently degrades into "no decision needed".
  assert.match(bridgeSource, /@deepseek-ai\/dsh-user-approval/, 'the approval service must be mounted')
  // `never` resolves every request to rejected, which breaks sandboxed runs
  // instead of gating them.
  assert.match(bridgeSource, /policy: ask/, 'the approval policy must be ask')
  assert.doesNotMatch(bridgeSource, /policy: never/, 'an approval policy of never would deny every sandboxed run')
})

test('a provider patch never replaces the sandbox patch', () => {
  // Reassigning the array was the shape of the bug: the last writer wins and
  // the policy patch silently disappears.
  assert.doesNotMatch(bridgeSource, /patches = \[patchFile\]/, 'pushes must append; assignment would drop the sandbox patch')
  assert.match(bridgeSource, /patches\.push\(patchFile\)/, 'the provider patch must be appended')
})

test('the bridge forwards an allowlist of configuration, not the ambient environment', () => {
  // The engine runs model-written shell commands. Forwarding process.env handed
  // it every credential the user's shell happened to hold.
  assert.doesNotMatch(bridgeSource, /const childEnv = \{ \.\.\.process\.env \}/, 'a full environment copy leaks unrelated secrets')
  assert.match(bridgeSource, /const childEnv = allowedChildEnv\(\)/, 'the child environment must be filtered')
  assert.match(bridgeSource, /const ENV_ALLOWLIST = new Set\(\[/, 'the allowlist must be explicit')
  // Network configuration has to survive the filter or a proxied run cannot
  // reach the model at all.
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']) {
    assert.ok(bridgeSource.includes(`'${name}'`), `${name} must stay allowed`)
  }
  // Credential-bearing variables must not be forwarded implicitly.
  for (const name of ['AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'NPM_TOKEN']) {
    assert.ok(!bridgeSource.includes(`'${name}'`), `${name} must not be forwarded`)
  }
})

test('delegating to the embedded engine is gated like code execution', () => {
  // The client never evaluates the delegated code in-process, so it is not a
  // script for preview purposes — but the engine runs its own shell commands,
  // so it is code execution for approval purposes.
  assert.match(agentSource, /const isHarnessDelegation = call\.function\.name === 'delegate_to_harness'/, 'the delegation must be recognised')
  assert.match(agentSource, /needsWorkspaceApproval\(approvalMode, isScript \|\| isHarnessDelegation/, 'the delegation must enter the approval set')
})
