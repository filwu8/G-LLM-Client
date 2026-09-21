/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { getSvgClipboardFormat } from './svgClipboard.ts'

test('uses the native SVG pasteboard type on macOS', () => {
  assert.equal(getSvgClipboardFormat('darwin'), 'public.svg-image')
})

test('uses the SVG MIME clipboard type on Windows and Linux', () => {
  assert.equal(getSvgClipboardFormat('win32'), 'image/svg+xml')
  assert.equal(getSvgClipboardFormat('linux'), 'image/svg+xml')
})
