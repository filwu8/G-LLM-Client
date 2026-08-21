/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ChatMessage, Conversation, ConversationProjectMemory } from '@shared/types'

export interface EditedConversationBranch {
  messages: ChatMessage[]
  projectMemory?: ConversationProjectMemory
}

export function replaceUserMessageBranch(
  conversation: Conversation,
  messageId: string,
  editedMessage: ChatMessage
): EditedConversationBranch | null {
  const messageIndex = conversation.messages.findIndex((message) => message.id === messageId)
  const originalMessage = conversation.messages[messageIndex]
  const content = editedMessage.content.trim()

  if (messageIndex < 0 || originalMessage?.role !== 'user' || editedMessage.role !== 'user' || !content) {
    return null
  }

  const messagesBeforeEdit = conversation.messages.slice(0, messageIndex)
  const priorChatMessageCount = messagesBeforeEdit.filter(
    (message) => message.role === 'user' || message.role === 'assistant'
  ).length
  const projectMemory = conversation.projectMemory &&
    conversation.projectMemory.sourceMessageCount <= priorChatMessageCount
    ? conversation.projectMemory
    : undefined

  return {
    messages: [...messagesBeforeEdit, { ...editedMessage, content }],
    projectMemory
  }
}
