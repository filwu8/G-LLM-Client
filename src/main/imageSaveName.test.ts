/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { getSuggestedImageSaveName } from './imageSaveName.ts'

test('adds unique timestamps to repeated image labels, including the same millisecond', () => {
  const first = getSuggestedImageSaveName('生成图片 1', 'png', 1788692180797)
  const second = getSuggestedImageSaveName('生成图片 1', 'png', 1788692180797)
  assert.equal(first, '生成图片 1-1788692180797.png')
  assert.equal(second, '生成图片 1-1788692180798.png')
})

test('keeps a safe stem and the actual image format', () => {
  assert.match(getSuggestedImageSaveName('../照片.jpeg', 'webp'), /^照片-\d+\.webp$/)
  assert.match(getSuggestedImageSaveName('bad:name?.png', 'png'), /^bad-name--\d+\.png$/)
  assert.match(getSuggestedImageSaveName(undefined, 'jpg'), /^G-LLM-image-\d+\.jpg$/)
})
