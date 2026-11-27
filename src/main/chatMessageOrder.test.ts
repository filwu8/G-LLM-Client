/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { demoteLateSystemMessages, permissionModeNote } from './chatMessageOrder.ts'

type Message = { role: string; content: unknown; tool_call_id?: string }

test('a prompt whose system messages all lead is returned untouched', () => {
  const messages: Message[] = [
    { role: 'system', content: 'policy' },
    { role: 'system', content: 'workspace state' },
    { role: 'user', content: '把这三个仓库同步一下' }
  ]
  // Same reference: the hot path must not allocate for the common case.
  assert.equal(demoteLateSystemMessages(messages), messages)
  assert.deepEqual(messages.map((item) => item.role), ['system', 'system', 'user'])
})

test('a system message that arrives after the user turn becomes a client note', () => {
  // This is the exact shape that produced
  // "HTTP 400 could not encode request: System message must be at the beginning"
  // when the user granted full access while a run was in flight: the client
  // appended a system message after the conversation had started.
  const messages: Message[] = [
    { role: 'system', content: 'policy' },
    { role: 'user', content: '同步仓库' },
    { role: 'assistant', content: '先看一下状态' },
    { role: 'system', content: '[权限模式已切换] 当前权限模式是完全访问权限' },
    { role: 'tool', content: 'ok', tool_call_id: 'call_1' }
  ]
  const normalized = demoteLateSystemMessages(messages)
  assert.deepEqual(normalized.map((item) => item.role), ['system', 'user', 'assistant', 'user', 'tool'])
  // Content is preserved and marked, and the position is unchanged: the note
  // still reads as something that happened at that point in the run.
  assert.equal(normalized[3].content, '[客户端提示] [权限模式已切换] 当前权限模式是完全访问权限')
  // Nothing else is rewritten.
  assert.equal(normalized[0].content, 'policy')
  assert.equal(normalized[4].tool_call_id, 'call_1')
})

test('normalizing twice changes nothing more', () => {
  const messages: Message[] = [
    { role: 'system', content: 'policy' },
    { role: 'user', content: 'go' },
    { role: 'system', content: 'mid-run note' }
  ]
  const once = demoteLateSystemMessages(messages)
  const twice = demoteLateSystemMessages(once)
  assert.equal(twice, once)
  assert.equal(once[2].content, '[客户端提示] mid-run note')
})

test('a non-text system payload keeps its body but loses the system role', () => {
  const parts = [{ type: 'text', text: 'screenshot' }]
  const messages: Message[] = [
    { role: 'user', content: '看这张图' },
    { role: 'system', content: parts }
  ]
  const normalized = demoteLateSystemMessages(messages)
  assert.equal(normalized[1].role, 'user')
  assert.equal(normalized[1].content, parts)
})

test('a leading system message is never demoted, even with a late one present', () => {
  const messages: Message[] = [
    { role: 'system', content: 'policy' },
    { role: 'user', content: 'go' },
    { role: 'user', content: '再补一句' },
    { role: 'system', content: 'late' }
  ]
  const normalized = demoteLateSystemMessages(messages)
  assert.equal(normalized[0].role, 'system')
  assert.equal(normalized[3].role, 'user')
})

test('the permission-mode note is a user turn naming the new mode', () => {
  // It used to be a system message, which is what strict gateways reject.
  for (const [mode, label] of [['full', '完全访问权限'], ['auto', '帮我批准'], ['ask', '请求批准']] as const) {
    const note = permissionModeNote(mode)
    assert.equal(note.role, 'user')
    assert.match(note.content, new RegExp(label))
  }
})
