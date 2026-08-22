/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { decideConversationWebSearch, decideWebSearch } from './webSearchMode.ts'

test('auto enables search for fresh information, URLs, and explicit browsing requests', () => {
  assert.equal(decideWebSearch('auto', '今天上海天气怎么样').enabled, true)
  assert.equal(decideWebSearch('auto', '帮我分析 https://example.com/pricing').enabled, true)
  assert.equal(decideWebSearch('auto', '请联网搜索一下这个问题').enabled, true)
})

test('auto avoids search for local development and writing tasks', () => {
  assert.equal(decideWebSearch('auto', '修复当前工作区里的 TypeScript 报错').enabled, false)
  assert.equal(decideWebSearch('auto', '帮我写一份项目周报').enabled, false)
  assert.equal(decideWebSearch('auto', '帮我生成一份项目报价方案').enabled, false)
  assert.equal(decideWebSearch('auto', '推荐一个清晰的函数命名').enabled, false)
  assert.equal(decideWebSearch('auto', '总结这个附件').enabled, false)
})

test('explicit modes override auto while acknowledgements never waste a search', () => {
  assert.equal(decideWebSearch('on', '解释这段代码').enabled, true)
  assert.equal(decideWebSearch('off', '查询今天的新闻').enabled, false)
  assert.equal(decideWebSearch('on', '谢谢').enabled, false)
})

test('auto respects an explicit per-message request not to browse', () => {
  assert.deepEqual(decideWebSearch('auto', '不要联网，直接根据已有知识回答'), {
    enabled: false,
    reason: 'user-disabled'
  })
})

test('conversation decision uses the latest user message', () => {
  assert.equal(decideConversationWebSearch('auto', [
    { id: '1', role: 'user', content: '今天有什么新闻', createdAt: 1 },
    { id: '2', role: 'assistant', content: '一些新闻', createdAt: 2 },
    { id: '3', role: 'user', content: '把上面的内容改写得简洁一点', createdAt: 3 }
  ]).enabled, false)
})
