/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { createHash } from 'node:crypto'

import type { ContextSavings } from '../shared/types.ts'

const largeArgumentCharacterThreshold = 1_200
const oldToolResultCharacterThreshold = 1_600
const compactPreviewCharacters = 600
const compactableArgumentKeys = new Set(['content', 'code', 'oldText', 'newText'])

export interface WorkspaceContextToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface WorkspaceContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
  tool_call_id?: string
  tool_calls?: WorkspaceContextToolCall[]
}

export interface PreparedWorkspaceContext<T extends WorkspaceContextMessage> {
  messages: T[]
  contextSavings?: ContextSavings
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function compactStoredValue(value: string, label: string): string {
  const normalizedPreview = value.replace(/\s+/g, ' ').trim().slice(0, compactPreviewCharacters)
  return `[${label}已压缩｜原始字符 ${value.length}｜sha256 ${digest(value)}]\n${normalizedPreview}${value.length > compactPreviewCharacters ? ' …' : ''}`
}

function compactToolArguments(argumentsText: string): { value: string; compactedItems: number } {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText || '{}')
  } catch {
    return argumentsText.length > largeArgumentCharacterThreshold
      ? { value: JSON.stringify({ archivedArguments: compactStoredValue(argumentsText, '已执行工具参数') }), compactedItems: 1 }
      : { value: argumentsText, compactedItems: 0 }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { value: argumentsText, compactedItems: 0 }
  }

  let compactedItems = 0
  const next = Object.fromEntries(Object.entries(parsed).map(([key, item]) => {
    if (!compactableArgumentKeys.has(key) || typeof item !== 'string' || item.length <= largeArgumentCharacterThreshold) return [key, item]
    compactedItems += 1
    return [key, compactStoredValue(item, `已执行参数 ${key}`)]
  }))

  return compactedItems > 0
    ? { value: JSON.stringify(next), compactedItems }
    : { value: argumentsText, compactedItems: 0 }
}

function characterLength(messages: WorkspaceContextMessage[]): number {
  return JSON.stringify(messages).length
}

/**
 * Build a request-only copy of the workspace transcript. The latest tool
 * result batch stays exact so the model can act on fresh reads. Older large
 * results and already-executed payloads become verifiable previews; the full
 * in-memory transcript remains untouched and files can be read again.
 */
export function prepareWorkspaceMessagesForRequest<T extends WorkspaceContextMessage>(messages: T[]): PreparedWorkspaceContext<T> {
  const originalCharacters = characterLength(messages)
  const lastToolResultIndex = messages.findLastIndex((message) => message.role === 'tool')
  let latestToolCallIndex = -1
  if (lastToolResultIndex >= 0) {
    for (let index = lastToolResultIndex; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant' && messages[index].tool_calls?.length) {
        latestToolCallIndex = index
        break
      }
    }
  }

  let compactedItems = 0
  const prepared = messages.map((message, index) => {
    let content = message.content
    if (
      message.role === 'tool' &&
      index < latestToolCallIndex &&
      typeof content === 'string' &&
      content.length > oldToolResultCharacterThreshold
    ) {
      content = `${compactStoredValue(content, '旧工具结果')}\n如需逐字内容，请再次调用对应读取工具。`
      compactedItems += 1
    }

    const toolCalls = message.tool_calls?.map((call) => {
      const compacted = compactToolArguments(call.function.arguments)
      compactedItems += compacted.compactedItems
      return compacted.value === call.function.arguments
        ? call
        : { ...call, function: { ...call.function, arguments: compacted.value } }
    })

    const toolCallsUnchanged = !message.tool_calls || toolCalls?.every((call, callIndex) => call === message.tool_calls?.[callIndex])
    if (content === message.content && toolCallsUnchanged) {
      return message
    }
    return { ...message, content, tool_calls: toolCalls } as T
  })

  const sentCharacters = characterLength(prepared)
  const savedCharacters = Math.max(0, originalCharacters - sentCharacters)
  return {
    messages: prepared,
    contextSavings: savedCharacters > 0
      ? {
          originalCharacters,
          sentCharacters,
          savedCharacters,
          savedPercent: Math.min(99, Math.round((savedCharacters / originalCharacters) * 100)),
          compactedItems
        }
      : undefined
  }
}
