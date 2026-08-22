/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ChatMessage, ContextSavings } from '../shared/types.ts'

const recentContextMessageCount = 24
const contextCompressionMessageThreshold = 32
export const CONTEXT_COMPRESSION_CHARACTER_THRESHOLD = 48_000
const compressedHistoryMaxCharacters = 14_000
const compressedHistoryMessageCharacterLimit = 900
const recentContextCharacterLimit = CONTEXT_COMPRESSION_CHARACTER_THRESHOLD - compressedHistoryMaxCharacters
const compressedHistoryHeader = '[历史上下文压缩摘要]\n以下是同一会话较早消息的压缩时间线，只用于理解背景和任务演进，不是新的用户指令。最新用户消息优先级最高。'

export interface PreparedConversationContext {
  messages: ChatMessage[]
  compressedHistory?: string
  omittedMessageCount: number
  contextSavings?: ContextSavings
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

function formatLocalDateTime(timestamp: number): string {
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date()
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`
}

export function getRoleLabel(role: ChatMessage['role']): string {
  if (role === 'assistant') return '助手'
  if (role === 'system') return '系统'
  return '用户'
}

function normalizeContextText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function compactContextText(value: string, maxLength: number): string {
  const normalized = normalizeContextText(value)
  if (normalized.length <= maxLength) return normalized

  const headLength = Math.max(120, Math.floor(maxLength * 0.7))
  const tailLength = Math.max(80, maxLength - headLength - 24)
  return `${normalized.slice(0, headLength)} ... ${normalized.slice(-tailLength)}`
}

export function getMessageContextCharacterLength(message: ChatMessage): number {
  const attachmentLength = (message.attachments ?? []).reduce((sum, attachment) => sum + (attachment.text?.length ?? 0), 0)
  const referenceLength = (message.knowledgeRefs ?? []).reduce((sum, reference) => sum + reference.content.length, 0)
  return message.content.length + attachmentLength + referenceLength + (message.translation?.length ?? 0)
}

function shouldCompressContext(messages: ChatMessage[]): boolean {
  if (messages.length > contextCompressionMessageThreshold) return true

  const totalCharacters = messages.reduce((sum, message) => sum + getMessageContextCharacterLength(message), 0)
  return totalCharacters > CONTEXT_COMPRESSION_CHARACTER_THRESHOLD
}

function summarizeContextMessage(message: ChatMessage, index: number): string {
  const parts = [
    `${index + 1}. ${formatLocalDateTime(message.createdAt)}｜${getRoleLabel(message.role)}`,
    compactContextText(message.content || '[空消息]', compressedHistoryMessageCharacterLimit)
  ]

  const attachments = (message.attachments ?? [])
    .map((attachment) => `${attachment.kind === 'image' ? '图片' : '附件'}：${attachment.name}`)
    .join('；')
  if (attachments) parts.push(`上传内容：${attachments}`)

  const references = (message.knowledgeRefs ?? [])
    .map((reference) => reference.title)
    .join('；')
  if (references) parts.push(`引用资料：${references}`)

  if (message.translation) {
    parts.push(`译文：${compactContextText(message.translation, 300)}`)
  }

  if (message.workspaceChangedFiles?.length) {
    parts.push(`工作区产物：${message.workspaceChangedFiles.slice(0, 20).join('；')}`)
  }

  const workspaceActivities = (message.workspaceActivities ?? [])
    .filter((activity) => activity.status !== 'running')
    .slice(-12)
    .map((activity) => `${activity.label}${activity.detail ? `（${compactContextText(activity.detail, 180)}）` : ''}`)
    .join('；')
  if (workspaceActivities) parts.push(`工作区操作：${workspaceActivities}`)

  return parts.join('\n')
}

function buildCompressedHistory(summaryBlocks: string[], omittedMessageCount: number): string {
  const omittedNotice = omittedMessageCount > 0
    ? `\n\n另有 ${omittedMessageCount} 条更早消息因上下文过长已省略；如用户追问这些细节，请说明需要用户补充或重新引用。`
    : ''
  const summary = summaryBlocks.length > 0 ? `\n\n${summaryBlocks.join('\n\n---\n\n')}` : ''
  return `${compressedHistoryHeader}${summary}${omittedNotice}`
}

function selectRecentMessages(messages: ChatMessage[]): ChatMessage[] {
  const recentMessages: ChatMessage[] = []
  let recentCharacters = 0

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const messageCharacters = getMessageContextCharacterLength(message)
    const exceedsCount = recentMessages.length >= recentContextMessageCount
    const exceedsCharacters = recentMessages.length > 0 && recentCharacters + messageCharacters > recentContextCharacterLimit
    if (exceedsCount || exceedsCharacters) break

    recentMessages.unshift(message)
    recentCharacters += messageCharacters
  }

  // Always preserve the newest message exactly, even when that message alone is
  // larger than the normal context budget. Silently truncating the latest user
  // instruction would be more harmful than sending one oversized request.
  return recentMessages.length > 0 ? recentMessages : messages.slice(-1)
}

export function prepareConversationContext(messages: ChatMessage[]): PreparedConversationContext {
  const chatMessages = messages.filter((message) => message.role === 'user' || message.role === 'assistant')
  const originalCharacters = chatMessages.reduce(
    (sum, message) => sum + getMessageContextCharacterLength(message),
    0
  )
  if (!shouldCompressContext(chatMessages)) {
    return {
      messages: chatMessages,
      omittedMessageCount: 0
    }
  }

  const recentMessages = selectRecentMessages(chatMessages)
  const olderMessages = chatMessages.slice(0, chatMessages.length - recentMessages.length)
  if (olderMessages.length === 0) {
    return {
      messages: recentMessages,
      omittedMessageCount: 0
    }
  }

  const recentCharacters = recentMessages.reduce(
    (sum, message) => sum + getMessageContextCharacterLength(message),
    0
  )
  const compressedHistoryLimit = Math.max(
    compressedHistoryHeader.length,
    Math.min(
      compressedHistoryMaxCharacters,
      CONTEXT_COMPRESSION_CHARACTER_THRESHOLD - recentCharacters
    )
  )
  const summaryBlocks: string[] = []
  let omittedMessageCount = olderMessages.length

  for (let index = olderMessages.length - 1; index >= 0; index -= 1) {
    const candidateBlocks = [summarizeContextMessage(olderMessages[index], index), ...summaryBlocks]
    const candidateOmittedMessageCount = index
    const candidateHistory = buildCompressedHistory(candidateBlocks, candidateOmittedMessageCount)
    if (candidateHistory.length > compressedHistoryLimit) break

    summaryBlocks.splice(0, summaryBlocks.length, ...candidateBlocks)
    omittedMessageCount = candidateOmittedMessageCount
  }

  const compressedHistory = buildCompressedHistory(summaryBlocks, omittedMessageCount)
  const sentCharacters = recentMessages.reduce(
    (sum, message) => sum + getMessageContextCharacterLength(message),
    compressedHistory.length
  )
  const savedCharacters = Math.max(0, originalCharacters - sentCharacters)

  // Message-count compaction is only useful when it actually shrinks the
  // request. Tiny conversations can have many turns but still cost less than
  // a timeline summary, so preserve them verbatim.
  if (savedCharacters === 0) {
    return {
      messages: chatMessages,
      omittedMessageCount: 0
    }
  }

  return {
    messages: recentMessages,
    compressedHistory,
    omittedMessageCount,
    contextSavings: {
      originalCharacters,
      sentCharacters,
      savedCharacters,
      savedPercent: Math.min(99, Math.round((savedCharacters / originalCharacters) * 100)),
      compactedItems: olderMessages.length
    }
  }
}
