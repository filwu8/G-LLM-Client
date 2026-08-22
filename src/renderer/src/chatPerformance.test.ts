/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { coalesceChatChunks, mergeConversationChange } from './chatPerformance.ts'
import type { ChatChunk, Conversation } from '../../shared/types.ts'

function conversation(id: string, updatedAt: number): Conversation {
  return {
    id,
    assistantId: 'assistant-a',
    title: id,
    messages: [],
    createdAt: 1,
    updatedAt
  }
}

test('coalesces a burst of normal stream fragments into one renderer update', () => {
  const chunks: ChatChunk[] = Array.from({ length: 200 }, (_, index) => ({
    conversationId: 'conversation-a',
    content: `${index},`,
    reasoningContent: index % 2 === 0 ? 'r' : undefined,
    done: index === 199,
    usage: index === 199 ? { inputTokens: 10, outputTokens: 20, totalTokens: 30 } : undefined
  }))

  const result = coalesceChatChunks(chunks)

  assert.equal(result.length, 1)
  assert.equal(result[0].content, chunks.map((chunk) => chunk.content).join(''))
  assert.equal(result[0].reasoningContent, 'r'.repeat(100))
  assert.equal(result[0].done, true)
  assert.deepEqual(result[0].usage, { inputTokens: 10, outputTokens: 20, totalTokens: 30 })
})

test('keeps context saving statistics when the final stream event is coalesced', () => {
  const result = coalesceChatChunks([
    { conversationId: 'conversation_1', content: 'answer' },
    {
      conversationId: 'conversation_1',
      content: '',
      done: true,
      contextSavings: {
        originalCharacters: 52_000,
        sentCharacters: 4_000,
        savedCharacters: 48_000,
        savedPercent: 92,
        compactedItems: 4
      }
    }
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].done, true)
  assert.equal(result[0].contextSavings?.savedPercent, 92)
})

test('keeps errors separate so preceding output is not discarded', () => {
  const result = coalesceChatChunks([
    { conversationId: 'conversation-a', content: 'partial answer' },
    { conversationId: 'conversation-a', content: '', error: 'provider failed', done: true }
  ])

  assert.equal(result.length, 2)
  assert.equal(result[0].content, 'partial answer')
  assert.equal(result[1].error, 'provider failed')
})

test('merges a saved conversation delta and preserves a live streaming draft', () => {
  const first = conversation('first', 1)
  const oldSecond = conversation('second', 2)
  const savedSecond = { ...oldSecond, modelId: 'new-model', updatedAt: 3 }
  const liveSecond = { ...savedSecond, messages: [{ id: 'message', role: 'assistant' as const, content: 'live', createdAt: 4 }] }

  const result = mergeConversationChange(
    [first, oldSecond],
    { action: 'saved', conversationId: 'second', conversation: savedSecond },
    liveSecond
  )

  assert.equal(result[0], liveSecond)
  assert.equal(result[1], first)
})

test('uses a full deletion snapshot when supplied', () => {
  const remaining = conversation('remaining', 2)
  const result = mergeConversationChange(
    [conversation('deleted', 1), remaining],
    { action: 'deleted', conversationId: 'deleted', conversations: [remaining] }
  )

  assert.deepEqual(result, [remaining])
})
