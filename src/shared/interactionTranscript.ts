/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type {
  ChatMessage,
  WorkspaceInteractionOption,
  WorkspaceInteractionRequest,
  WorkspaceInteractionResponse
} from './types.ts'

/** Prefix that marks a message as a record of an answered question. */
const ANSWER_MESSAGE_PREFIX = 'msg_answer_'

/**
 * The id of the transcript message a question produces.
 *
 * Both sides may write this message — the renderer when the user clicks, the
 * main process when the answer comes back through the agent channel — so the id
 * is derived from the question instead of being random. The two writes are then
 * the same message, and answering twice cannot stack up duplicates.
 */
export function interactionAnswerMessageId(interactionId: string): string {
  return `${ANSWER_MESSAGE_PREFIX}${interactionId}`
}

export function isInteractionAnswerMessageId(id: string): boolean {
  return id.startsWith(ANSWER_MESSAGE_PREFIX)
}

/**
 * Render an answer as a conversation line.
 *
 * The run injects `[用户回答]` into the model's private message list, which the
 * transcript never shows. Without this line the choice a user just made leaves
 * no trace: the card closes and the conversation looks untouched.
 */
export function describeInteractionAnswer(
  request: WorkspaceInteractionRequest,
  response: WorkspaceInteractionResponse,
  language: 'zh' | 'en' = 'zh'
): string {
  if (response.cancelled) return ''
  const zh = language === 'zh'
  const labels = response.selectedIds
    .map((id) => request.options.find((option) => option.id === id))
    .filter((option): option is WorkspaceInteractionOption => Boolean(option))
    .map((option) => option.label)
  const lines: string[] = []
  if (labels.length > 0) lines.push(zh ? `选择：${labels.join('、')}` : `Selected: ${labels.join(', ')}`)
  if (response.customText) lines.push(zh ? `补充：${response.customText}` : `Note: ${response.customText}`)
  if (lines.length === 0) {
    if (request.selection !== 'confirm') return ''
    return zh ? `已回答「${request.title}」` : `Answered "${request.title}"`
  }
  const head = zh ? `已回答「${request.title}」` : `Answered "${request.title}"`
  return `${head}\n${lines.join('\n')}`
}

/** The conversation message for an answer, or undefined when nothing was said. */
export function interactionAnswerMessage(
  request: WorkspaceInteractionRequest,
  response: WorkspaceInteractionResponse,
  language: 'zh' | 'en' = 'zh',
  at = Date.now()
): ChatMessage | undefined {
  const content = describeInteractionAnswer(request, response, language)
  if (!content) return undefined
  return {
    id: interactionAnswerMessageId(request.id),
    role: 'user',
    content,
    createdAt: at,
    inputTokens: 0,
    outputTokens: 0
  }
}

/**
 * Is `userId` still the newest user turn of the conversation?
 *
 * A run's result may only be appended while the user has not moved on. Answer
 * transcripts are written *during* the run, so the message after the request is
 * often the client's own record of that answer — tolerating exactly those keeps
 * a run alive after the user replies. Anything else means a newer turn exists
 * and the stored run is stale.
 */
export function isLatestUserTurn(messages: ChatMessage[], userId: string): boolean {
  const index = messages.findLastIndex((message) => message.id === userId)
  if (index < 0) return false
  return messages.slice(index + 1).every((message) => isInteractionAnswerMessageId(message.id))
}
