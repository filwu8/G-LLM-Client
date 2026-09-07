/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { getSuggestedImageSaveName } from './imageSaveName.ts'

test('adds a readable millisecond timestamp to avoid accidental overwrites', () => {
  const now = new Date(2026, 8, 7, 14, 30, 25, 123).getTime()
  assert.equal(getSuggestedImageSaveName(undefined, 'png', now), 'G-LLM-image-20260907-143025-123.png')
  assert.equal(getSuggestedImageSaveName('', 'webp', now), 'G-LLM-image-20260907-143025-123.webp')
})

test('keeps a safe supplied image name', () => {
  const now = new Date(2026, 8, 7, 14, 30, 25, 123).getTime()
  assert.equal(getSuggestedImageSaveName('生成图片 1.png', 'png', now), '生成图片 1-20260907-143025-123.png')
  assert.equal(getSuggestedImageSaveName('brand:logo?.jpg', 'png', now), 'brand-logo-20260907-143025-123.png')
})
