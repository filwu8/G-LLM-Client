/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareWorkspaceMessagesForRequest,
  type WorkspaceContextMessage
} from './workspaceContext.ts'

function toolCall(id: string, name: string, args: Record<string, unknown>): WorkspaceContextMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  }
}

test('keeps the latest tool result exact and compacts an older large result', () => {
  const oldResult = `old-start-${'a'.repeat(12_000)}-old-end`
  const latestResult = `latest-start-${'b'.repeat(8_000)}-latest-end`
  const messages: WorkspaceContextMessage[] = [
    { role: 'system', content: 'system' },
    toolCall('call_1', 'read_file', { path: 'old.ts' }),
    { role: 'tool', tool_call_id: 'call_1', content: oldResult },
    toolCall('call_2', 'read_file', { path: 'current.ts', offset: 0 }),
    { role: 'tool', tool_call_id: 'call_2', content: latestResult }
  ]

  const prepared = prepareWorkspaceMessagesForRequest(messages)

  assert.notEqual(prepared.messages[2].content, oldResult)
  assert.match(String(prepared.messages[2].content), /旧工具结果已压缩/)
  assert.equal(prepared.messages[4].content, latestResult)
  assert.equal(messages[2].content, oldResult)
  assert.ok((prepared.contextSavings?.savedCharacters ?? 0) > 10_000)
})

test('compacts large executed write arguments but preserves small routing arguments', () => {
  const content = `begin-${'payload'.repeat(2_000)}-end`
  const messages: WorkspaceContextMessage[] = [
    toolCall('call_1', 'write_file', { path: 'output.txt', content }),
    { role: 'tool', tool_call_id: 'call_1', content: 'written' }
  ]

  const prepared = prepareWorkspaceMessagesForRequest(messages)
  const args = JSON.parse(prepared.messages[0].tool_calls?.[0].function.arguments ?? '{}') as Record<string, string>

  assert.equal(args.path, 'output.txt')
  assert.match(args.content, /已执行参数 content已压缩/)
  assert.equal(JSON.parse(messages[0].tool_calls?.[0].function.arguments ?? '{}').content, content)
})

test('does not change a small transcript', () => {
  const messages: WorkspaceContextMessage[] = [
    toolCall('call_1', 'inspect_file', { path: 'README.md' }),
    { role: 'tool', tool_call_id: 'call_1', content: '{"size":42}' }
  ]

  const prepared = prepareWorkspaceMessagesForRequest(messages)

  assert.deepEqual(prepared.messages, messages)
  assert.equal(prepared.contextSavings, undefined)
})
