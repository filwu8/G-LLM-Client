/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSeatConversation, seatConversationId, seatConversationTitle } from './seatConversationRecord.ts'
import type { Conversation, WorkspaceToolActivity } from '../shared/types'

const workspace = { rootPath: '/seats/reviewer' } as Conversation['workspace']
const seat = { id: 'seat-reviewer', name: '审稿席位', modelProviderId: 'p', modelId: 'm' }
const base = {
  parentConversationId: 'conv-console',
  parentAssistantId: 'assistant-console',
  seat,
  workspace,
  startedAt: 1_000
}
const step = (id: string): WorkspaceToolActivity => ({
  id,
  tool: 'read_file',
  label: id,
  status: 'completed',
  detail: id
})

test('dispatch-time record exists before the run finishes, so the console can link to it', () => {
  const conversation = buildSeatConversation({ ...base, runId: 'run-1', task: '把 README 里的过时链接修掉，顺手补一节迁移说明', now: 2_000 })
  assert.equal(conversation.id, seatConversationId('conv-console', 'seat-reviewer'))
  assert.equal(conversation.assistantId, 'seat-reviewer')
  assert.deepEqual(conversation.delegatedFrom, { assistantId: 'assistant-console', conversationId: 'conv-console' })
  assert.equal(conversation.messages.length, 1)
  assert.equal(conversation.messages[0].role, 'user')
  assert.equal(conversation.messages[0].content, '把 README 里的过时链接修掉，顺手补一节迁移说明')
  assert.equal(conversation.title, seatConversationTitle('审稿席位', '把 README 里的过时链接修掉，顺手补一节迁移说明'))
})

test('a finished run appends its steps and output to the record opened at dispatch', () => {
  const opened = buildSeatConversation({ ...base, runId: 'run-1', task: '检查依赖', now: 2_000 })
  const finished = buildSeatConversation({
    ...base,
    existing: opened,
    runId: 'run-1',
    task: '检查依赖',
    now: 3_000,
    outcome: { content: '依赖没问题', activities: [step('a'), step('b')], changedFiles: ['package.json'], outputTokens: 12 }
  })
  assert.equal(finished.messages.length, 2)
  assert.equal(finished.messages[1].role, 'assistant')
  assert.equal(finished.messages[1].content, '依赖没问题')
  assert.equal(finished.messages[1].workspaceActivities?.length, 2)
  assert.deepEqual(finished.messages[1].workspaceChangedFiles, ['package.json'])
  assert.equal(finished.totalOutputTokens, 12)
})

test('a failed run keeps its task and every step it managed to take', () => {
  const opened = buildSeatConversation({ ...base, runId: 'run-2', task: '跑一遍测试', now: 2_000 })
  const failed = buildSeatConversation({
    ...base,
    existing: opened,
    runId: 'run-2',
    task: '跑一遍测试',
    now: 3_000,
    outcome: { content: '失败：命令超时', activities: [step('c')] }
  })
  assert.equal(failed.messages.length, 2)
  assert.equal(failed.messages[1].content, '失败：命令超时')
  assert.equal(failed.messages[1].workspaceActivities?.length, 1)
})

test('re-saving one run does not duplicate its messages', () => {
  const once = buildSeatConversation({ ...base, runId: 'run-1', task: '任务A', now: 2_000 })
  const twice = buildSeatConversation({ ...base, existing: once, runId: 'run-1', task: '任务A', now: 2_500 })
  assert.equal(twice.messages.length, 1)
})

test('a second dispatch adds its own task and title instead of reusing the first one', () => {
  const first = buildSeatConversation({ ...base, runId: 'run-1', task: '第一件事', now: 2_000 })
  const second = buildSeatConversation({ ...base, existing: first, runId: 'run-2', task: '第二件事：整理发布说明', now: 4_000 })
  assert.equal(second.messages.length, 2)
  assert.deepEqual(second.messages.map(message => message.content), ['第一件事', '第二件事：整理发布说明'])
  assert.equal(second.title, seatConversationTitle('审稿席位', '第二件事：整理发布说明'))
})
