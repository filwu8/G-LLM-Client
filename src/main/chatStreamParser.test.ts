/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isCompleteStreamDataPayload,
  parseStreamDataPayload,
  streamChatResponseEvents,
  type ChatStreamEvent
} from './chatStreamParser.ts'

test('parses regular OpenAI streaming content and usage together', () => {
  const event = parseStreamDataPayload(JSON.stringify({
    choices: [{ delta: { content: '答案' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
  }))

  assert.deepEqual(event, {
    content: '答案',
    reasoningContent: '',
    usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    finishReason: 'stop',
    isTruncated: false
  })
})

test('parses Nemotron reasoning_content deltas before final content arrives', () => {
  const event = parseStreamDataPayload(JSON.stringify({
    choices: [{ delta: { reasoning_content: '先分析问题' } }]
  }))

  assert.deepEqual(event, {
    content: '',
    reasoningContent: '先分析问题',
    usage: undefined,
    finishReason: undefined,
    isTruncated: undefined
  })
})

test('accepts common reasoning field variants from compatible gateways', () => {
  const camelCase = parseStreamDataPayload(JSON.stringify({
    choices: [{ message: { reasoningContent: 'reasoning', content: 'final' } }]
  }))
  const analysisContent = parseStreamDataPayload(JSON.stringify({
    choices: [{ delta: { analysis_content: 'analysis' } }]
  }))

  assert.equal(camelCase?.reasoningContent, 'reasoning')
  assert.equal(camelCase?.content, 'final')
  assert.equal(analysisContent?.reasoningContent, 'analysis')
})

test('recognizes complete single-line SSE payloads without accepting partial JSON', () => {
  assert.equal(isCompleteStreamDataPayload('{"choices":[]}'), true)
  assert.equal(isCompleteStreamDataPayload('[DONE]'), true)
  assert.equal(isCompleteStreamDataPayload('{"choices":['), false)
})

test('streams single-newline reasoning records without waiting for the response to close', async () => {
  const response = new Response([
    'data: {"choices":[{"delta":{"reasoning_content":"分析"}}]}',
    'data: {"choices":[{"delta":{"content":"答案"},"finish_reason":"stop"}]}',
    'data: [DONE]',
    ''
  ].join('\n'))
  const events: ChatStreamEvent[] = []

  for await (const event of streamChatResponseEvents(response)) events.push(event)

  assert.equal(events.length, 2)
  assert.equal(events[0].reasoningContent, '分析')
  assert.equal(events[1].content, '答案')
  assert.equal(events[1].finishReason, 'stop')
})
