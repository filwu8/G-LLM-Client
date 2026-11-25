/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { formatBuildCode, resolveBuildCode } from './buildCode.ts'

const builtAt = new Date(2026, 10, 25, 8, 10).getTime()

test('formatBuildCode pads every field to two digits', () => {
  assert.equal(formatBuildCode(new Date(2026, 0, 2, 3, 4)), '202601020304')
  assert.equal(formatBuildCode(new Date(2026, 10, 25, 8, 10)), '202611250810')
})

test('an operator override outranks the injected constant', () => {
  assert.equal(
    resolveBuildCode({ envCode: '202601010000', injectedCode: '202611250810', isPackaged: true, scriptMtimeMs: 0 }),
    '202601010000'
  )
})

test('a packaged build uses the constant injected at bundle time', () => {
  assert.equal(resolveBuildCode({ injectedCode: '202611250810', isPackaged: true }), '202611250810')
})

test('a packaged build never adopts a file time', () => {
  // The regression this guards: inside app.asar the mtime is the current clock,
  // so accepting it made the label describe the launch rather than the build.
  const now = Date.now()
  assert.equal(resolveBuildCode({ isPackaged: true, scriptMtimeMs: now }), '')
})

test('a packaged build with no injection shows no code rather than the current time', () => {
  assert.equal(resolveBuildCode({ isPackaged: true }), '')
  assert.equal(resolveBuildCode({ isPackaged: true, injectedCode: '   ' }), '')
})

test('an unpackaged build formats the real script mtime', () => {
  assert.equal(resolveBuildCode({ isPackaged: false, scriptMtimeMs: builtAt }), '202611250810')
})

test('an unpackaged build with no readable mtime shows no code', () => {
  assert.equal(resolveBuildCode({ isPackaged: false }), '')
  assert.equal(resolveBuildCode({ isPackaged: false, scriptMtimeMs: Number.NaN }), '')
})

test('a blank override is ignored instead of blanking the label', () => {
  assert.equal(resolveBuildCode({ envCode: '   ', injectedCode: '202611250810', isPackaged: true }), '202611250810')
})
