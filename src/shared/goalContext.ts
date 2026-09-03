/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ChatMessage, GoalContextMode, GoalTask, ResolvedGoalContextMode } from './types'

const stopWords = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'then', 'please', '完成', '进行', '一个', '这个', '需要', '帮我', '目标', '项目'
])
const continuationPattern = /(?:继续|接着|基于(?:之前|当前|上一个)|沿用|完善|补充|修复刚才|此前)|\b(?:continue|based on|carry on|previous|existing|same)\b/i
const isolationPattern = /(?:完全无关|独立目标|全新任务|不要参考之前|忽略之前)|\b(?:unrelated|independent goal|new unrelated task|ignore (?:the )?previous)\b/i

function semanticTokens(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase()
  const tokens = normalized.match(/[a-z0-9][a-z0-9_.-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []
  const expanded: string[] = []
  for (const token of tokens) {
    if (stopWords.has(token)) continue
    if (/^[\u4e00-\u9fff]+$/.test(token)) {
      for (let index = 0; index < token.length - 1; index += 1) expanded.push(token.slice(index, index + 2))
    } else {
      expanded.push(token)
    }
  }
  return new Set(expanded)
}

function relatedness(left: string, right: string): number {
  const leftTokens = semanticTokens(left)
  const rightTokens = semanticTokens(right)
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let overlap = 0
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1
  return overlap / Math.min(leftTokens.size, rightTokens.size)
}

export function resolveGoalContextMode(
  requestedMode: GoalContextMode,
  goal: string,
  acceptanceCriteria: string,
  previousGoal: Pick<GoalTask, 'goal' | 'acceptanceCriteria'> | undefined,
  previousMessages: ChatMessage[]
): ResolvedGoalContextMode {
  if (requestedMode !== 'auto') return requestedMode
  const request = `${goal}\n${acceptanceCriteria}`
  if (isolationPattern.test(request)) return 'isolated'
  if (continuationPattern.test(request)) return 'continue'
  if (!previousGoal && previousMessages.length === 0) return 'isolated'

  const previousGoalText = previousGoal ? `${previousGoal.goal}\n${previousGoal.acceptanceCriteria}` : ''
  if (previousGoalText && relatedness(request, previousGoalText) >= 0.18) return 'continue'
  const recentHistory = previousMessages.slice(-12).map((message) => message.content).join('\n')
  if (relatedness(request, recentHistory) >= 0.08) return 'relevant'
  return 'isolated'
}

export function selectGoalContextMessages(messages: ChatMessage[], task?: GoalTask): ChatMessage[] {
  if (!task?.contextStartMessageId || !task.resolvedContextMode || task.resolvedContextMode === 'continue') return messages
  const startIndex = messages.findIndex((message) => message.id === task.contextStartMessageId)
  if (startIndex < 0) return messages
  const currentGoalMessages = messages.slice(startIndex)
  if (task.resolvedContextMode === 'isolated') return currentGoalMessages

  const target = `${task.goal}\n${task.acceptanceCriteria}`
  const selectedIndexes = new Set<number>()
  messages.slice(0, startIndex).forEach((message, index) => {
    if (relatedness(target, message.content) < 0.08) return
    selectedIndexes.add(index)
    if (index > 0 && messages[index - 1].role !== message.role) selectedIndexes.add(index - 1)
    if (index + 1 < startIndex && messages[index + 1].role !== message.role) selectedIndexes.add(index + 1)
  })
  const relevantHistory = Array.from(selectedIndexes)
    .sort((left, right) => left - right)
    .slice(-12)
    .map((index) => messages[index])
  return [...relevantHistory, ...currentGoalMessages]
}
