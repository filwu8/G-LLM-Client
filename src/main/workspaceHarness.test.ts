/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  configureHarnessEnvironment,
  harnessBridgePath,
  inspectHarnessRuntime,
  nodeMajorFromVersion,
  setHarnessRuntimeOverride
} from './workspaceHarness.ts'

test('nodeMajorFromVersion parses node version strings', () => {
  assert.equal(nodeMajorFromVersion('v24.22.3'), 24)
  assert.equal(nodeMajorFromVersion('22.1.0'), 22)
  assert.equal(nodeMajorFromVersion('garbage'), 0)
  assert.equal(nodeMajorFromVersion(''), 0)
})

test('harnessBridgePath follows dev vs packaged layout', () => {
  configureHarnessEnvironment({ isPackaged: false, appPath: '/app', resourcesPath: '/res' })
  assert.equal(harnessBridgePath().replace(/\\/g, '/'), '/app/resources/harness-bridge.mjs')
  configureHarnessEnvironment({ isPackaged: true, appPath: '/app', resourcesPath: '/res' })
  assert.equal(harnessBridgePath().replace(/\\/g, '/'), '/res/resources/harness-bridge.mjs')
})

test('inspectHarnessRuntime reports unavailable for a missing override', () => {
  configureHarnessEnvironment({ isPackaged: true, appPath: '/nonexistent-app', resourcesPath: '/nonexistent-res' })
  setHarnessRuntimeOverride('/definitely/not/a/runtime')
  delete process.env.DSH_GLLM_RUNTIME
  const info = inspectHarnessRuntime()
  assert.equal(info.available, false)
  assert.ok(info.reason)
  setHarnessRuntimeOverride(undefined)
})

test('inspectHarnessRuntime finds a prepared runtime with node + SDK client', async () => {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'gllm-harness-inspect-'))
  try {
    const nodeBin = join(root, 'node', 'bin')
    await mkdir(nodeBin, { recursive: true })
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
    await writeFile(join(nodeBin, nodeName), '')
    const sdkDir = join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-client')
    await mkdir(sdkDir, { recursive: true })
    configureHarnessEnvironment({ isPackaged: true, appPath: '/nonexistent', resourcesPath: '/nonexistent' })
    setHarnessRuntimeOverride(root)
    const info = inspectHarnessRuntime()
    assert.equal(info.available, true)
    assert.equal(info.nodePath, join(nodeBin, nodeName))
    assert.equal(info.runtimeDir, root)
  } finally {
    setHarnessRuntimeOverride(undefined)
    const { rm } = await import('node:fs/promises')
    await rm(root, { recursive: true, force: true })
  }
})
