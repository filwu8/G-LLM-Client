/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { Assistant, Conversation } from '@shared/types'
import { calculateLocalUsageStats } from './localUsageStats.ts'

const now = Date.UTC(2026, 8, 1, 12)
const assistant = { id: 'a1', name: '开发助手' } as Assistant

test('calculates local tokens, durations, streaks, and rankings', () => {
  const conversations: Conversation[] = [{
    id: 'c1', assistantId: 'a1', title: '开发助手', modelId: 'gpt-5.4', createdAt: now, updatedAt: now,
    messages: [
      { id: 'u1', role: 'user', content: 'hello', tokenCount: 10, createdAt: now - 86_400_000 },
      { id: 'a1', role: 'assistant', content: 'done', tokenCount: 20, createdAt: now - 86_400_000, responseStartedAt: now - 86_400_000 - 5000, responseCompletedAt: now - 86_400_000, workspaceActivities: [{ id: 't1', tool: 'write_file', label: '写入文件', status: 'completed' }] },
      { id: 'u2', role: 'user', content: 'again', inputTokens: 5, createdAt: now },
      { id: 'a2', role: 'assistant', content: 'done', outputTokens: 15, createdAt: now, responseStartedAt: now - 3000, responseCompletedAt: now }
    ]
  }]

  const stats = calculateLocalUsageStats(conversations, [assistant], 'UTC', now, 7)
  assert.equal(stats.totalTokens, 50)
  assert.equal(stats.totalDurationMs, 8000)
  assert.equal(stats.longestConversationDurationMs, 8000)
  assert.equal(stats.activeDays, 2)
  assert.equal(stats.currentStreak, 2)
  assert.equal(stats.longestStreak, 2)
  assert.equal(stats.completedResponses, 2)
  assert.equal(stats.toolCalls, 1)
  assert.deepEqual(stats.topModels[0], { id: 'gpt-5.4', label: 'gpt-5.4', count: 2 })
  assert.deepEqual(stats.topAssistants[0], { id: 'a1', label: '开发助手', count: 2 })
})

test('only includes the selected activity window in the heatmap', () => {
  const conversation: Conversation = {
    id: 'c1', assistantId: 'a1', title: '开发助手', createdAt: now, updatedAt: now,
    messages: [{ id: 'old', role: 'user', content: 'old', tokenCount: 99, createdAt: now - 20 * 86_400_000 }]
  }
  const stats = calculateLocalUsageStats([conversation], [assistant], 'UTC', now, 7)
  assert.equal(stats.totalTokens, 99)
  assert.equal(stats.activeDays, 1)
  assert.equal(stats.peakDayTokens, 99)
  assert.equal(stats.days.every((day) => day.tokens === 0), true)
})
