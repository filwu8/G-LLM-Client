/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ComposerSessionTarget, Conversation, MainConversationOpenRequest } from './types'

const MAX_HANDOFF_ID_LENGTH = 180

function normalizeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_HANDOFF_ID_LENGTH) return undefined
  return normalized
}

export function createMainConversationOpenRequest(conversation: Conversation): MainConversationOpenRequest {
  return {
    conversationId: conversation.id,
    projectId: conversation.projectId,
    assistantId: conversation.assistantId
  }
}

export function normalizeMainConversationOpenRequest(value: unknown): MainConversationOpenRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const input = value as Record<string, unknown>
  const conversationId = normalizeId(input.conversationId)
  if (!conversationId) return null

  return {
    conversationId,
    projectId: normalizeId(input.projectId),
    assistantId: normalizeId(input.assistantId)
  }
}

export function findMainConversationTarget(
  conversations: Conversation[],
  request: MainConversationOpenRequest
): Conversation | null {
  return conversations.find((conversation) => (
    conversation.id === request.conversationId &&
    (!request.projectId || conversation.projectId === request.projectId) &&
    (!request.assistantId || conversation.assistantId === request.assistantId)
  )) ?? null
}

export function normalizeComposerSessionTarget(value: unknown): ComposerSessionTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const assistantId = normalizeId(input.assistantId)
  if (!assistantId) return null
  return {
    conversationId: normalizeId(input.conversationId),
    projectId: normalizeId(input.projectId),
    assistantId
  }
}

export function shouldRestoreMainWindowFromStatusIcon(
  target: 'main' | 'quick',
  hasMainWindow: boolean
): boolean {
  return target === 'main' && hasMainWindow
}
