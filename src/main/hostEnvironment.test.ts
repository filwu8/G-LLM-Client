/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHostEnvironmentContext } from './hostEnvironment.ts'

test('Mac instructions use actual OS/architecture and do not substitute installer scripts', () => {
  const context = buildHostEnvironmentContext({ platform: 'darwin', release: '25.0.0', arch: 'arm64' })
  assert.match(context, /OS: macOS; kernel version: 25.0.0; architecture: arm64/)
  assert.match(context, /\/bin\/sh \(POSIX\)/)
  assert.match(context, /do not create \.ps1/)
  assert.match(context, /Computer & browser/)
  assert.match(context, /no computer execution/)
})

test('agent instructions distinguish Windows workspace CMD from computer PowerShell', () => {
  const context = buildHostEnvironmentContext({ platform: 'win32', release: '10.0', arch: 'x64' }, true)
  assert.match(context, /Workspace shell: Windows CMD batch/)
  assert.match(context, /Computer command shell: Windows PowerShell/)
  assert.match(context, /Creating an installer script alone does not complete an installation/)
  assert.match(context, /approval on every call/)
  assert.doesNotMatch(context, /This chat has no/)
})
