/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { Conversation, ConversationWorkspace, WebSearchActivity } from '@shared/types'

export type ConversationRunStatus = 'running' | 'completed' | 'error'

export interface ConversationRunState {
  status: ConversationRunStatus
  startedAt: number
  finishedAt?: number
}

export type ConversationRunStates = Record<string, ConversationRunState>

export function stopPendingWebSearch(activity?: WebSearchActivity): WebSearchActivity | undefined {
  if (!activity || !['planning', 'searching'].includes(activity.status)) return activity
  return {
    ...activity,
    status: 'stopped',
    activeQueries: [],
    error: 'stopped'
  }
}

export function stopConversationWebSearch(conversation: Conversation): Conversation {
  let changed = false
  const messages = conversation.messages.map((message) => {
    const webSearch = stopPendingWebSearch(message.webSearch)
    if (webSearch === message.webSearch) return message
    changed = true
    return { ...message, webSearch }
  })
  return changed ? { ...conversation, messages, updatedAt: Date.now() } : conversation
}

/** A just-created, untouched conversation is UI draft state rather than
 * meaningful history. It can be safely reused or collapsed in the sidebar. */
export function isPristineConversationDraft(conversation: Conversation): boolean {
  return conversation.messages.length === 0 &&
    !conversation.workspace &&
    !conversation.projectMemory &&
    !conversation.pinnedAt &&
    (conversation.reasoningEffort === undefined || conversation.reasoningEffort === 'default') &&
    conversation.updatedAt === conversation.createdAt
}

export function collapsePristineConversationDrafts(
  conversations: Conversation[],
  activeConversationId?: string | null
): Conversation[] {
  const drafts = conversations.filter(isPristineConversationDraft)
  if (drafts.length === 0) return conversations

  const activeDraftId = drafts.find((conversation) => conversation.id === activeConversationId)?.id
  return conversations.filter((conversation) =>
    !isPristineConversationDraft(conversation) || conversation.id === activeDraftId
  )
}

/** Preserve a workspace authorized before the first message when another
 * action (such as changing model or reasoning effort) materializes the draft
 * into a saved conversation. */
export function attachDraftWorkspace(
  conversation: Conversation,
  draftWorkspace?: ConversationWorkspace
): Conversation {
  if (!draftWorkspace || conversation.workspace) return conversation
  return { ...conversation, workspace: draftWorkspace }
}

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
