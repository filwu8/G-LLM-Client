/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeDownloadProgress, normalizeReleaseNotes, supportsAutomaticUpdate } from './updatePolicy.ts'

test('automatic installation is enabled only for packaged Windows and macOS builds', () => {
  assert.equal(supportsAutomaticUpdate(true, 'win32'), true)
  assert.equal(supportsAutomaticUpdate(true, 'darwin'), true)
  assert.equal(supportsAutomaticUpdate(true, 'linux'), false)
  assert.equal(supportsAutomaticUpdate(false, 'win32'), false)
  assert.equal(supportsAutomaticUpdate(false, 'darwin'), false)
})

test('release notes accept updater strings and note arrays without exposing arbitrary objects', () => {
  assert.equal(normalizeReleaseNotes('  Fixed updates.  '), 'Fixed updates.')
  assert.equal(
    normalizeReleaseNotes([{ version: '2.0.4', note: 'First fix' }, { note: 'Second fix' }]),
    'First fix\n\nSecond fix'
  )
  assert.equal(normalizeReleaseNotes({ note: 'ignored' }), undefined)
})

test('download progress is finite and clamped', () => {
  assert.equal(normalizeDownloadProgress(42.26), 42.3)
  assert.equal(normalizeDownloadProgress(-1), 0)
  assert.equal(normalizeDownloadProgress(101), 100)
  assert.equal(normalizeDownloadProgress(Number.NaN), 0)
})
