/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createOutputTokenBudget, outputEncoding } from './workspaceTokenBudget.ts'
import { WorkspaceOutputStore } from './workspaceOutputStore.ts'
test('known model encodings and unknown byte fallback are explicit; special-token literals are ordinary text', async () => {
  assert.equal(outputEncoding('gpt-5.6-luna'), 'o200k_base')
  assert.equal(outputEncoding('gpt-4-turbo'), 'cl100k_base')
  assert.equal(outputEncoding('custom-gpt-alias'), 'utf8-bytes')
  const unknown = await createOutputTokenBudget('claude-custom')
  assert.equal(unknown.count('中文🧪'), Buffer.byteLength('中文🧪'))
  for (const model of ['gpt-5.6-luna', 'gpt-4-turbo']) {
    const budget = await createOutputTokenBudget(model)
    assert.ok(budget.count('<|endoftext|> 中文🧪') > 0)
    assert.equal(budget.count('hello world'), 2)
  }
})
test('six multilingual tool results share a token budget and paged recovery is lossless', async () => {
  const budget = await createOutputTokenBudget('gpt-5.6-luna'), store = new WorkspaceOutputStore(undefined, undefined, budget.count)
  const original = '日志中文🧪\\"\t 日本語 한국어\n'.repeat(500)
  let tokens = budget.perRound, characters = 24000
  for (let i = 0; i < 6; i++) {
    const limit = Math.min(budget.perTool, Math.floor(tokens / (6 - i)))
    const result = store.capture(String(i), original, Math.floor(characters / (6 - i)), limit)
    assert.ok(budget.count(result.output) <= limit)
    tokens -= budget.count(result.output); characters -= result.output.length
  }
  assert.ok(tokens >= 0); assert.ok(characters >= 0)
  const args = JSON.parse(store.referenceForCall('0')!.match(/read_tool_output (\{.*?\})/)![1])
  let recovered = '', pages = 0
  while (true) {
    const text = store.read(args, 4000, 1000)
    assert.ok(budget.count(text) <= 1000)
    const page = JSON.parse(text); recovered += page.content
    if (page.complete) break
    assert.ok(++pages < 100); Object.assign(args, page.next)
  }
  assert.equal(recovered, original)
})
