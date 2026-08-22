/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getMacScreenCapturePermissionError,
  getMacScreenshotArguments,
  getScreenshotBackend
} from './screenshotPlatform.ts'

test('selects the native screenshot backend for Windows and macOS', () => {
  assert.equal(getScreenshotBackend('win32'), 'windows-screenclip')
  assert.equal(getScreenshotBackend('darwin'), 'macos-screencapture')
  assert.equal(getScreenshotBackend('linux'), 'unsupported')
})

test('builds a macOS interactive region capture without using the clipboard', () => {
  assert.deepEqual(
    getMacScreenshotArguments('/tmp/gllm-screenshot.png'),
    ['-i', '-s', '-x', '-t', 'png', '/tmp/gllm-screenshot.png']
  )
})

test('distinguishes macOS permission failures from user cancellation', () => {
  assert.equal(getMacScreenCapturePermissionError('granted', ''), null)
  assert.match(getMacScreenCapturePermissionError('denied', '') ?? '', /屏幕录制权限/)
  assert.match(getMacScreenCapturePermissionError('unknown', 'could not create image from display') ?? '', /系统设置/)
})
