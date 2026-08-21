/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { Conversation } from '@shared/types'

export type ConversationRunStatus = 'running' | 'completed' | 'error'

export interface ConversationRunState {
  status: ConversationRunStatus
  startedAt: number
  finishedAt?: number
}

export type ConversationRunStates = Record<string, ConversationRunState>

export function syncConversationUpdateIntoStreamingDrafts(
  drafts: Record<string, Conversation>,
  conversation: Conversation
): Record<string, Conversation> {
  if (!drafts[conversation.id]) return drafts
  return { ...drafts, [conversation.id]: conversation }
}

export function startConversationRun(
  states: ConversationRunStates,
  conversationId: string,
  startedAt = Date.now()
): ConversationRunStates {
  return {
    ...states,
    [conversationId]: { status: 'running', startedAt }
  }
}

export function finishConversationRun(
  states: ConversationRunStates,
  conversationId: string,
  activeConversationId: string | null,
  outcome: 'completed' | 'error',
  finishedAt = Date.now()
): ConversationRunStates {
  const current = states[conversationId]
  if (!current) return states

  if (conversationId === activeConversationId) {
    const next = { ...states }
    delete next[conversationId]
    return next
  }

  return {
    ...states,
    [conversationId]: {
      ...current,
      status: outcome,
      finishedAt
    }
  }
}

export function acknowledgeConversationRun(
  states: ConversationRunStates,
  conversationId: string
): ConversationRunStates {
  if (!states[conversationId] || states[conversationId].status === 'running') return states
  const next = { ...states }
  delete next[conversationId]
  return next
}

export function removeConversationRun(
  states: ConversationRunStates,
  conversationId: string
): ConversationRunStates {
  if (!states[conversationId]) return states
  const next = { ...states }
  delete next[conversationId]
  return next
}

export function isConversationRunning(states: ConversationRunStates, conversationId?: string | null): boolean {
  return Boolean(conversationId && states[conversationId]?.status === 'running')
}
