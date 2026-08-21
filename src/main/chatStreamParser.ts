/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export interface ChatStreamEvent {
  content?: string
  reasoningContent?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  finishReason?: string
  isTruncated?: boolean
}

interface StreamChoice {
  delta?: Record<string, unknown>
  message?: Record<string, unknown>
  text?: unknown
  finish_reason?: unknown
  finishReason?: unknown
  native_finish_reason?: unknown
  nativeFinishReason?: unknown
  stop_reason?: unknown
}

interface StreamPayload {
  choices?: StreamChoice[]
  candidates?: Array<{ finishReason?: unknown }>
  finish_reason?: unknown
  finishReason?: unknown
  native_finish_reason?: unknown
  nativeFinishReason?: unknown
  stop_reason?: unknown
  reasoning_content?: unknown
  reasoningContent?: unknown
  response?: {
    candidates?: Array<{ finishReason?: unknown }>
    stop_reason?: unknown
  }
  usage?: unknown
}

function parseUsage(payload: unknown): ChatStreamEvent['usage'] | undefined {
  const usage = (payload as { usage?: Record<string, unknown> })?.usage
  if (!usage) return undefined

  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0)
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0)
  const totalTokens = Number(usage.total_tokens ?? inputTokens + outputTokens)

  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || !Number.isFinite(totalTokens)) {
    return undefined
  }

  return {
    inputTokens: Math.max(0, Math.round(inputTokens)),
    outputTokens: Math.max(0, Math.round(outputTokens)),
    totalTokens: Math.max(0, Math.round(totalTokens))
  }
}

export function extractTextContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (!Array.isArray(value)) return ''

  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''

      const item = part as { text?: unknown; content?: unknown; type?: unknown }
      return extractTextContent(item.text ?? item.content)
    })
    .join('')
}

function extractStreamContent(payload: StreamPayload): string {
  const choice = payload.choices?.[0]
  if (!choice) return ''

  return (
    extractTextContent(choice.delta?.content) ||
    extractTextContent(choice.message?.content) ||
    extractTextContent(choice.text)
  )
}

function extractStreamReasoningContent(payload: StreamPayload): string {
  const choice = payload.choices?.[0]
  const delta = choice?.delta
  const message = choice?.message

  return (
    extractTextContent(delta?.reasoning_content) ||
    extractTextContent(delta?.reasoningContent) ||
    extractTextContent(delta?.reasoning) ||
    extractTextContent(delta?.analysis_content) ||
    extractTextContent(message?.reasoning_content) ||
    extractTextContent(message?.reasoningContent) ||
    extractTextContent(message?.reasoning) ||
    extractTextContent(message?.analysis_content) ||
    extractTextContent(payload.reasoning_content) ||
    extractTextContent(payload.reasoningContent)
  )
}

function normalizeFinishReason(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
}

function extractStreamFinishReason(payload: StreamPayload): string {
  const choice = payload.choices?.[0]
  const values = [
    choice?.finish_reason,
    choice?.finishReason,
    choice?.native_finish_reason,
    choice?.nativeFinishReason,
    choice?.stop_reason,
    payload.finish_reason,
    payload.finishReason,
    payload.native_finish_reason,
    payload.nativeFinishReason,
    payload.stop_reason,
    payload.candidates?.[0]?.finishReason,
    payload.response?.candidates?.[0]?.finishReason,
    payload.response?.stop_reason
  ]

  for (const value of values) {
    const reason = normalizeFinishReason(value)
    if (reason) return reason
  }
  return ''
}

function isTruncatedFinishReason(reason: string): boolean {
  const normalized = reason.replace(/[\s-]+/g, '_')
  return ['length', 'max_tokens', 'max_output_tokens', 'token_limit'].includes(normalized)
}

export function parseStreamDataPayload(data: string): ChatStreamEvent | null {
  const trimmed = data.trim()
  if (!trimmed || trimmed === '[DONE]') return null

  try {
    const parsed = JSON.parse(trimmed) as StreamPayload
    const content = extractStreamContent(parsed)
    const reasoningContent = extractStreamReasoningContent(parsed)
    const usage = parseUsage(parsed)
    const finishReason = extractStreamFinishReason(parsed)
    if (!content && !reasoningContent && !usage && !finishReason) return null
    return {
      content,
      reasoningContent,
      usage,
      finishReason: finishReason || undefined,
      isTruncated: finishReason ? isTruncatedFinishReason(finishReason) : undefined
    }
  } catch {
    return null
  }
}

export function isCompleteStreamDataPayload(data: string): boolean {
  const trimmed = data.trim()
  if (!trimmed || trimmed === '[DONE]') return true
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

export function getSseEventData(eventBlock: string): string[] {
  const dataLines = eventBlock
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())

  if (dataLines.length > 0) return [dataLines.join('\n')]

  const trimmed = eventBlock.trim()
  return trimmed ? [trimmed] : []
}

export async function* streamChatResponseEvents(response: Response): AsyncGenerator<ChatStreamEvent> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function* drainStreamBuffer(final = false): Generator<ChatStreamEvent> {
    const separatorPattern = /\r?\n\r?\n/
    let match = buffer.match(separatorPattern)

    while (match?.index !== undefined) {
      const eventBlock = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      for (const data of getSseEventData(eventBlock)) {
        if (data.trim() === '[DONE]') return
        const parsed = parseStreamDataPayload(data)
        if (parsed) yield parsed
      }
      match = buffer.match(separatorPattern)
    }

    // A few OpenAI-compatible gateways terminate each `data:` record with a
    // single newline instead of a complete SSE blank line. Drain complete JSON
    // records eagerly so a long reasoning stream does not remain buffered until
    // the connection closes.
    while (true) {
      const lineMatch = buffer.match(/\r?\n/)
      if (lineMatch?.index === undefined) break
      const rawLine = buffer.slice(0, lineMatch.index)
      const trimmedLine = rawLine.trim()
      if (!trimmedLine || trimmedLine.startsWith(':') || trimmedLine.startsWith('event:')) {
        buffer = buffer.slice(lineMatch.index + lineMatch[0].length)
        continue
      }

      const data = trimmedLine.startsWith('data:') ? trimmedLine.slice(5).trimStart() : trimmedLine
      if (!isCompleteStreamDataPayload(data)) break
      buffer = buffer.slice(lineMatch.index + lineMatch[0].length)
      if (data === '[DONE]') continue
      const parsed = parseStreamDataPayload(data)
      if (parsed) yield parsed
    }

    if (!final || !buffer.trim()) return
    const tail = buffer
    buffer = ''
    for (const data of getSseEventData(tail)) {
      if (data.trim() === '[DONE]') return
      const parsed = parseStreamDataPayload(data)
      if (parsed) yield parsed
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      buffer += decoder.decode()
      for (const event of drainStreamBuffer(true)) yield event
      break
    }
    buffer += decoder.decode(value, { stream: true })
    for (const event of drainStreamBuffer()) yield event
  }
}
