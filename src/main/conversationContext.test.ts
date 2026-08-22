/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTEXT_COMPRESSION_CHARACTER_THRESHOLD,
  getMessageContextCharacterLength,
  prepareConversationContext
} from './conversationContext.ts'
import type { ChatMessage } from '../shared/types.ts'

function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, role, content, createdAt: Date.UTC(2026, 7, 22, 0, 0, Number(id.replace(/\D/g, '')) || 0) }
}

function preparedCharacterLength(context: ReturnType<typeof prepareConversationContext>): number {
  return context.messages.reduce(
    (sum, item) => sum + getMessageContextCharacterLength(item),
    context.compressedHistory?.length ?? 0
  )
}

test('keeps ordinary short conversations unchanged', () => {
  const messages = [
    message('1', 'user', '你好'),
    message('2', 'assistant', '你好，需要什么帮助？'),
    message('3', 'user', '查看工作区')
  ]

  const context = prepareConversationContext(messages)

  assert.deepEqual(context.messages, messages)
  assert.equal(context.compressedHistory, undefined)
  assert.equal(context.omittedMessageCount, 0)
})

test('compresses a small number of messages when an older assistant reply is oversized', () => {
  const latestUser = message('5', 'user', '继续处理这个工作区')
  const messages = [
    message('1', 'user', '第一轮问题'.repeat(30)),
    message('2', 'assistant', '第一轮回答'.repeat(1_800)),
    message('3', 'user', '补充要求'.repeat(20)),
    message('4', 'assistant', `超长回答开头${'内容'.repeat(21_500)}超长回答结尾`),
    latestUser
  ]

  const context = prepareConversationContext(messages)

  assert.deepEqual(context.messages, [latestUser])
  assert.ok(context.compressedHistory?.includes('超长回答开头'))
  assert.ok(context.compressedHistory?.includes('超长回答结尾'))
  assert.ok((context.compressedHistory?.length ?? 0) < 5_000)
  assert.ok(preparedCharacterLength(context) <= CONTEXT_COMPRESSION_CHARACTER_THRESHOLD)
  assert.ok((context.contextSavings?.savedCharacters ?? 0) > 40_000)
  assert.ok((context.contextSavings?.savedPercent ?? 0) >= 90)
})

test('always preserves an oversized latest user instruction exactly', () => {
  const latestUser = message('2', 'user', `最新指令开头${'需求'.repeat(20_000)}最新指令结尾`)
  const messages = [
    message('1', 'assistant', '旧回答'.repeat(15_000)),
    latestUser
  ]

  const context = prepareConversationContext(messages)

  assert.deepEqual(context.messages, [latestUser])
  assert.equal(context.messages[0].content, latestUser.content)
  assert.ok(context.compressedHistory?.includes('旧回答'))
  assert.ok(preparedCharacterLength(context) <= CONTEXT_COMPRESSION_CHARACTER_THRESHOLD)
})

test('caps the verbatim recent window by message count', () => {
  const messages = Array.from({ length: 33 }, (_, index) =>
    message(String(index + 1), index % 2 === 0 ? 'user' : 'assistant', `消息 ${index + 1} ${'内容'.repeat(600)}`)
  )

  const context = prepareConversationContext(messages)

  assert.equal(context.messages.length, 24)
  assert.equal(context.messages[0].id, '10')
  assert.equal(context.messages.at(-1)?.id, '33')
  assert.ok(context.compressedHistory?.includes('消息 1'))
  assert.equal(context.omittedMessageCount, 0)
})
