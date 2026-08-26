/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { stabilizeStreamingMarkdown } from './streamingMarkdown.ts'

test('temporarily closes unfinished strong text during streaming', () => {
  assert.equal(stabilizeStreamingMarkdown('结论：**建议先检查网络'), '结论：**建议先检查网络**')
  assert.equal(stabilizeStreamingMarkdown('结论：**建议先检查网络**。'), '结论：**建议先检查网络**。')
})

test('closes nested inline markers in reverse order', () => {
  assert.equal(stabilizeStreamingMarkdown('**重点 `code'), '**重点 `code`**')
  assert.equal(stabilizeStreamingMarkdown('__重点 ~~暂定'), '__重点 ~~暂定~~__')
})

test('does not interpret escaped or whitespace-only markers as formatting', () => {
  assert.equal(stabilizeStreamingMarkdown('显示 \\** 原始标记'), '显示 \\** 原始标记')
  assert.equal(stabilizeStreamingMarkdown('2 ** 3 = 6'), '2 ** 3 = 6')
})

test('leaves fenced code to the block normalizer', () => {
  const content = '```md\n**literal'
  assert.equal(stabilizeStreamingMarkdown(content), content)
})
