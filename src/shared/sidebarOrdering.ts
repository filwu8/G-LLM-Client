/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { Assistant, Conversation } from './types'

function validTimestamp(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : 0
}

function comparePinned(first: { pinnedAt?: number }, second: { pinnedAt?: number }): number {
  const firstPinnedAt = validTimestamp(first.pinnedAt)
  const secondPinnedAt = validTimestamp(second.pinnedAt)
  if (firstPinnedAt === 0 && secondPinnedAt === 0) return 0
  if (firstPinnedAt === 0) return 1
  if (secondPinnedAt === 0) return -1
  return secondPinnedAt - firstPinnedAt
}

export function sortConversationsForSidebar<T extends Pick<Conversation, 'pinnedAt' | 'updatedAt'>>(
  conversations: T[]
): T[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((first, second) => {
      const pinnedOrder = comparePinned(first.conversation, second.conversation)
      if (pinnedOrder !== 0) return pinnedOrder

      const firstPinned = validTimestamp(first.conversation.pinnedAt) > 0
      const secondPinned = validTimestamp(second.conversation.pinnedAt) > 0
      if (firstPinned && secondPinned) return first.index - second.index

      const activityOrder = validTimestamp(second.conversation.updatedAt) - validTimestamp(first.conversation.updatedAt)
      return activityOrder || first.index - second.index
    })
    .map(({ conversation }) => conversation)
}

export function sortAssistantsForSidebar<T extends Pick<Assistant, 'id' | 'pinnedAt'>>(
  assistants: T[],
  conversations: Array<Pick<Conversation, 'assistantId' | 'updatedAt'>>
): T[] {
  const latestConversationByAssistant = new Map<string, number>()
  for (const conversation of conversations) {
    const updatedAt = validTimestamp(conversation.updatedAt)
    const current = latestConversationByAssistant.get(conversation.assistantId) ?? 0
    if (updatedAt > current) latestConversationByAssistant.set(conversation.assistantId, updatedAt)
  }

  return assistants
    .map((assistant, index) => ({ assistant, index }))
    .sort((first, second) => {
      const pinnedOrder = comparePinned(first.assistant, second.assistant)
      if (pinnedOrder !== 0) return pinnedOrder

      const firstPinned = validTimestamp(first.assistant.pinnedAt) > 0
      const secondPinned = validTimestamp(second.assistant.pinnedAt) > 0
      if (firstPinned && secondPinned) return first.index - second.index

      const firstActivity = latestConversationByAssistant.get(first.assistant.id) ?? 0
      const secondActivity = latestConversationByAssistant.get(second.assistant.id) ?? 0
      const activityOrder = secondActivity - firstActivity
      return activityOrder || first.index - second.index
    })
    .map(({ assistant }) => assistant)
}
