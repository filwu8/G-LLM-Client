/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { Assistant, Conversation } from '@shared/types'

export interface UsageDay {
  key: string
  timestamp: number
  tokens: number
  messages: number
  responses: number
  durationMs: number
}

export interface UsageRankingItem {
  id: string
  label: string
  count: number
}

export interface LocalUsageStats {
  totalTokens: number
  peakDayTokens: number
  totalDurationMs: number
  longestConversationDurationMs: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  completedResponses: number
  toolCalls: number
  days: UsageDay[]
  topModels: UsageRankingItem[]
  topAssistants: UsageRankingItem[]
  topTools: UsageRankingItem[]
}

function dateKey(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function messageTokens(message: Conversation['messages'][number]): number {
  const total = Number(message.tokenCount)
  if (Number.isFinite(total) && total >= 0) return Math.round(total)
  const input = Number(message.inputTokens)
  const output = Number(message.outputTokens)
  return Math.max(0, (Number.isFinite(input) ? Math.round(input) : 0) + (Number.isFinite(output) ? Math.round(output) : 0))
}

function addRanking(map: Map<string, UsageRankingItem>, id: string, label: string, count = 1) {
  const current = map.get(id)
  map.set(id, { id, label, count: (current?.count ?? 0) + count })
}

function sortedRanking(map: Map<string, UsageRankingItem>, limit = 5): UsageRankingItem[] {
  return [...map.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)).slice(0, limit)
}

function dayOrdinal(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function calculateStreaks(activeDayKeys: Set<string>, todayKey: string): { current: number; longest: number } {
  const activeDays = [...activeDayKeys].map(dayOrdinal).sort((left, right) => left - right)
  let running = 0
  let longest = 0
  let previous: number | undefined
  for (const day of activeDays) {
    running = previous !== undefined && day === previous + 1 ? running + 1 : 1
    longest = Math.max(longest, running)
    previous = day
  }

  const activeSet = new Set(activeDays)
  let current = 0
  for (let day = dayOrdinal(todayKey); activeSet.has(day); day -= 1) current += 1
  return { current, longest }
}

export function calculateLocalUsageStats(
  conversations: Conversation[],
  assistants: Assistant[],
  timeZone: string,
  now = Date.now(),
  dayCount = 84
): LocalUsageStats {
  const normalizedDayCount = Math.max(7, Math.min(366, Math.round(dayCount)))
  const days: UsageDay[] = Array.from({ length: normalizedDayCount }, (_, index) => {
    const timestamp = now - (normalizedDayCount - index - 1) * 86_400_000
    return { key: dateKey(timestamp, timeZone), timestamp, tokens: 0, messages: 0, responses: 0, durationMs: 0 }
  })
  const daysByKey = new Map(days.map((day) => [day.key, day]))
  const historicalTokensByDay = new Map<string, number>()
  const activeDayKeys = new Set<string>()
  const assistantNames = new Map(assistants.map((assistant) => [assistant.id, assistant.name]))
  const modelRanking = new Map<string, UsageRankingItem>()
  const assistantRanking = new Map<string, UsageRankingItem>()
  const toolRanking = new Map<string, UsageRankingItem>()
  let totalTokens = 0
  let totalDurationMs = 0
  let longestConversationDurationMs = 0
  let completedResponses = 0
  let toolCalls = 0

  for (const conversation of conversations) {
    const modelId = conversation.modelId?.trim() || 'unknown'
    const assistantName = assistantNames.get(conversation.assistantId) ?? conversation.title
    let conversationDurationMs = 0
    for (const message of conversation.messages) {
      const tokens = messageTokens(message)
      totalTokens += tokens
      const messageDayKey = dateKey(message.createdAt, timeZone)
      activeDayKeys.add(messageDayKey)
      historicalTokensByDay.set(messageDayKey, (historicalTokensByDay.get(messageDayKey) ?? 0) + tokens)
      const day = daysByKey.get(messageDayKey)
      if (day) {
        day.tokens += tokens
        day.messages += 1
      }

      const isCompletedResponse = message.role === 'assistant' && !message.error && Boolean(
        message.content.trim() || message.reasoningContent?.trim() || message.workspaceChangedFiles?.length
      )
      if (isCompletedResponse) {
        completedResponses += 1
        addRanking(modelRanking, modelId, modelId)
        if (day) day.responses += 1
        const startedAt = Number(message.responseStartedAt)
        const completedAt = Number(message.responseCompletedAt)
        if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt) {
          const duration = Math.min(completedAt - startedAt, 24 * 60 * 60 * 1000)
          totalDurationMs += duration
          conversationDurationMs += duration
          if (day) day.durationMs += duration
        }
      } else if (message.role === 'user') {
        addRanking(assistantRanking, conversation.assistantId, assistantName)
      }

      for (const activity of message.workspaceActivities ?? []) {
        if (activity.status !== 'completed' || activity.tool === 'understand_goal') continue
        toolCalls += 1
        addRanking(toolRanking, activity.tool, activity.label || activity.tool)
      }
    }
    longestConversationDurationMs = Math.max(longestConversationDurationMs, conversationDurationMs)
  }

  const streaks = calculateStreaks(activeDayKeys, dateKey(now, timeZone))
  return {
    totalTokens,
    peakDayTokens: Math.max(0, ...historicalTokensByDay.values()),
    totalDurationMs,
    longestConversationDurationMs,
    activeDays: activeDayKeys.size,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    completedResponses,
    toolCalls,
    days,
    topModels: sortedRanking(modelRanking),
    topAssistants: sortedRanking(assistantRanking),
    topTools: sortedRanking(toolRanking)
  }
}
