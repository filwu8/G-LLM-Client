/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ChatChunk, Conversation, ConversationChangeEvent } from '@shared/types'

function appendNotice(current: string | undefined, next: string | undefined): string | undefined {
  if (!next || next === current) return current
  return current ? `${current}\n${next}` : next
}

function canCoalesceChatChunks(current: ChatChunk, next: ChatChunk): boolean {
  return (
    !current.done &&
    !current.error &&
    !next.error &&
    current.conversationId === next.conversationId &&
    current.purpose === next.purpose &&
    current.targetMessageId === next.targetMessageId
  )
}

/**
 * Gate very small streaming fragments before they reach React. Providers can
 * emit dozens of SSE events in one frame; rendering each event separately
 * repeatedly tokenizes and parses the complete accumulated answer.
 */
export function coalesceChatChunks(chunks: ChatChunk[]): ChatChunk[] {
  const coalesced: ChatChunk[] = []

  for (const chunk of chunks) {
    const current = coalesced.at(-1)
    if (!current || !canCoalesceChatChunks(current, chunk)) {
      coalesced.push(chunk)
      continue
    }

    coalesced[coalesced.length - 1] = {
      ...current,
      content: `${current.content}${chunk.content}`,
      reasoningContent: `${current.reasoningContent ?? ''}${chunk.reasoningContent ?? ''}` || undefined,
      webSearch: chunk.webSearch ?? current.webSearch,
      usage: chunk.usage ?? current.usage,
      contextSavings: chunk.contextSavings ?? current.contextSavings,
      done: Boolean(current.done || chunk.done) || undefined,
      warning: appendNotice(current.warning, chunk.warning),
      finishReason: chunk.finishReason ?? current.finishReason,
      isTruncated: Boolean(current.isTruncated || chunk.isTruncated) || undefined
    }
  }

  return coalesced
}

/** Merge the small IPC delta used for normal saves without replacing the
 * complete conversation collection. Deletions can still carry a full list so
 * callers can choose the next active conversation deterministically.
 */
export function mergeConversationChange(
  conversations: Conversation[],
  change: ConversationChangeEvent,
  liveConversation?: Conversation
): Conversation[] {
  if (change.conversations) return change.conversations
  if (change.action === 'deleted') {
    return conversations.filter((conversation) => conversation.id !== change.conversationId)
  }

  const changedConversation = liveConversation?.id === change.conversationId
    ? liveConversation
    : change.conversation
  if (!changedConversation) return conversations

  const current = conversations.find((conversation) => conversation.id === changedConversation.id)
  if (current === changedConversation && conversations[0] === changedConversation) return conversations
  return [changedConversation, ...conversations.filter((conversation) => conversation.id !== changedConversation.id)]
}
