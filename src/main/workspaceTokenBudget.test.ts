/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createOutputTokenBudget, outputEncoding } from './workspaceTokenBudget.ts'
import { TOOL_OUTPUT_CHARACTERS, TOOL_ROUND_CHARACTERS, WorkspaceOutputStore } from './workspaceOutputStore.ts'

/**
 * Mirrors how a round divides its budget between concurrent tool calls, so the
 * assertions below describe what the model actually receives rather than what the
 * constants say in isolation.
 */
function roundAllowance(budget: { perTool: number; perRound: number }, calls: number) {
  return {
    characters: Math.min(TOOL_OUTPUT_CHARACTERS, Math.floor(TOOL_ROUND_CHARACTERS / calls)),
    bytes: Math.min(budget.perTool, Math.floor(budget.perRound / calls)),
    tokens: Math.min(budget.perTool, Math.floor(budget.perRound / calls))
  }
}

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

test('a realistic round leaves room for a whole file in every concurrent call', async () => {
  // The old ceilings gave each of six concurrent calls 4,000 characters, while an
  // ordinary 300-600 line source file is 10,000-25,000 characters. That forced the
  // model to truncate and re-read, which is the defect this guards against.
  const sixCalls = roundAllowance({ perTool: Infinity, perRound: Infinity }, 6)
  assert.ok(sixCalls.characters >= 12_000, `six concurrent calls get ${sixCalls.characters} characters`)

  // CJK costs three UTF-8 bytes per character, so the byte ceiling decides how much
  // Chinese text a tool-free model can read. It must not fall back to a few hundred.
  const byteBudget = await createOutputTokenBudget('claude-custom')
  const cjkCharacters = Math.min(sixCalls.characters, Math.floor(roundAllowance(byteBudget, 6).bytes / 3))
  assert.ok(cjkCharacters >= 5_000, `six concurrent calls get ${cjkCharacters} Chinese characters`)

  // The round ceiling is shared, so it must stay a small multiple of the per-tool one
  // or a single call could consume the whole round. It also has to stay in the same
  // order as the 50,000-character continuous-run compaction point documented in
  // workspaceOutputStore, otherwise every heavy round forces a history compaction.
  const ratio = TOOL_ROUND_CHARACTERS / TOOL_OUTPUT_CHARACTERS
  assert.ok(ratio >= 1 && ratio <= 4, `round ceiling is ${ratio}x the per-tool ceiling`)
  assert.ok(TOOL_ROUND_CHARACTERS <= 100_000, `round ceiling is ${TOOL_ROUND_CHARACTERS}`)
})

test('six multilingual tool results share a token budget and paged recovery is lossless', async () => {
  const budget = await createOutputTokenBudget('gpt-5.6-luna'), store = new WorkspaceOutputStore(undefined, undefined, budget.count)
  const original = '日志中文🧪\\"\t 日本語 한국어\n'.repeat(1200)
  let tokens = budget.perRound, characters = TOOL_ROUND_CHARACTERS
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
    assert.ok(++pages < 200); Object.assign(args, page.next)
  }
  assert.equal(recovered, original)
})
