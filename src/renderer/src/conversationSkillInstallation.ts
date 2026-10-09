/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { Conversation } from '@shared/types'
import { rendererI18n } from './i18n'

/** Local management messages do not consume model tokens or require a model key. */
export function prepareSkillInstallationConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: [...conversation.messages.map((message, index) => index === conversation.messages.length - 1
      ? { ...message, tokenCount: 0, inputTokens: 0, outputTokens: 0 }
      : message), {
      id: `message_${crypto.randomUUID()}`, role: 'assistant', content: rendererI18n.t('skillInstall.installing'),
      createdAt: Date.now(), responseStartedAt: Date.now(), tokenCount: 0, inputTokens: 0, outputTokens: 0
    }],
    updatedAt: Date.now()
  }
}

export async function saveSkillInstallationFailure(conversation: Conversation, error: unknown): Promise<Conversation> {
  const detail = error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
    : rendererI18n.t('skillInstall.failed')
  const finished: Conversation = {
    ...conversation,
    messages: conversation.messages.map((message, index) => index === conversation.messages.length - 1
      ? { ...message, content: detail, responseCompletedAt: Date.now() }
      : message),
    updatedAt: Date.now()
  }
  try { return await window.gllm.saveConversation(finished) } catch {
    return { ...finished, messages: finished.messages.map((message, index) => index === finished.messages.length - 1
      ? { ...message, content: `${detail}\n\n${rendererI18n.t('skillInstall.historySaveFailed')}` }
      : message) }
  }
}
