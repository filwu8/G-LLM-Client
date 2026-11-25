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
  type?: unknown
  delta?: { type?: unknown; text?: unknown; thinking?: unknown; stop_reason?: unknown }
  message?: { usage?: Record<string, unknown> }
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown; thought?: unknown }> }
    finishReason?: unknown
    finish_reason?: unknown
  }>
  usageMetadata?: Record<string, unknown>
  error?: { message?: unknown }
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

/** Anthropic reports prompt tokens once, before any text arrives, and the
 * completion count at the end. The two halves are added up here so a consumer
 * that keeps "the last usage it saw" still ends with a complete total. */
export interface StreamUsageState {
  anthropicInputTokens: number
}

function readUsageNumber(usage: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(usage[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

function parseUsage(payload: unknown, state?: StreamUsageState): ChatStreamEvent['usage'] | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>

  const anthropicUsage =
    record.type === 'message_start'
      ? (record.message as { usage?: Record<string, unknown> } | undefined)?.usage
      : record.type === 'message_delta'
        ? (record.usage as Record<string, unknown> | undefined)
        : undefined
  if (anthropicUsage) {
    if (record.type === 'message_start' && state) {
      state.anthropicInputTokens = Math.max(0, Math.round(readUsageNumber(anthropicUsage, 'input_tokens')))
    }
    const inputTokens = state?.anthropicInputTokens ?? Math.max(0, Math.round(readUsageNumber(anthropicUsage, 'input_tokens')))
    const outputTokens = Math.max(0, Math.round(readUsageNumber(anthropicUsage, 'output_tokens')))
    if (!inputTokens && !outputTokens) return undefined
    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
  }

  const geminiUsage = record.usageMetadata as Record<string, unknown> | undefined
  if (geminiUsage) {
    const inputTokens = Math.max(0, Math.round(readUsageNumber(geminiUsage, 'promptTokenCount')))
    const outputTokens = Math.max(0, Math.round(readUsageNumber(geminiUsage, 'candidatesTokenCount')))
    const totalTokens = Math.max(0, Math.round(readUsageNumber(geminiUsage, 'totalTokenCount') || inputTokens + outputTokens))
    if (!inputTokens && !outputTokens && !totalTokens) return undefined
    return { inputTokens, outputTokens, totalTokens: totalTokens || inputTokens + outputTokens }
  }

  const usage = record.usage as Record<string, unknown> | undefined
  if (!usage) return undefined

  const inputTokens = readUsageNumber(usage, 'prompt_tokens', 'input_tokens')
  const outputTokens = readUsageNumber(usage, 'completion_tokens', 'output_tokens')
  const totalTokens = readUsageNumber(usage, 'total_tokens') || inputTokens + outputTokens

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
  if (payload.type === 'content_block_delta' && typeof payload.delta?.text === 'string') {
    return payload.delta.text
  }
  const nativeParts = payload.candidates?.[0]?.content?.parts
  if (Array.isArray(nativeParts)) {
    return nativeParts
      .filter((part) => part && part.thought !== true && typeof part.text === 'string')
      .map((part) => String(part.text))
      .join('')
  }
  const choice = payload.choices?.[0]
  if (!choice) return ''

  return (
    extractTextContent(choice.delta?.content) ||
    extractTextContent(choice.message?.content) ||
    extractTextContent(choice.text)
  )
}

function extractStreamReasoningContent(payload: StreamPayload): string {
  if (payload.type === 'content_block_delta' && typeof payload.delta?.thinking === 'string') {
    return payload.delta.thinking
  }
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
    payload.delta?.stop_reason,
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

export function parseStreamDataPayload(
  data: string,
  state: StreamUsageState = { anthropicInputTokens: 0 }
): ChatStreamEvent | null {
  const trimmed = data.trim()
  if (!trimmed || trimmed === '[DONE]') return null

  try {
    const parsed = JSON.parse(trimmed) as StreamPayload
    const content = extractStreamContent(parsed)
    const reasoningContent = extractStreamReasoningContent(parsed)
    const usage = parseUsage(parsed, state)
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

/** Anthropic and some gateways report a mid-stream failure as a normal SSE
 * frame. Surfacing it as a throw keeps the caller from treating a broken call
 * as a short but successful answer. */
export function readStreamError(data: string): Error | null {
  const trimmed = data.trim()
  if (!trimmed.startsWith('{')) return null
  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown; error?: { message?: unknown; type?: unknown } }
    if (parsed.type !== 'error') return null
    const detail = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
    const kind = typeof parsed.error?.type === 'string' ? parsed.error.type : 'stream_error'
    return new Error(detail ? `${kind}: ${detail}` : kind)
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

function streamIdleTimeoutError(timeoutMs: number): DOMException {
  return new DOMException(
    `Model stream was idle for ${Math.max(1, Math.ceil(timeoutMs / 1000))} seconds`,
    'TimeoutError'
  )
}

async function readChatStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  idleTimeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal?.throwIfAborted()
  return await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      void reader.cancel().catch(() => undefined)
      rejectPromise(streamIdleTimeoutError(idleTimeoutMs))
    }, idleTimeoutMs)
    const handleAbort = () => {
      clearTimeout(timeout)
      void reader.cancel().catch(() => undefined)
      rejectPromise(signal?.reason)
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
    void reader.read().then(resolvePromise, rejectPromise).finally(() => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
    })
  })
}

export async function* streamChatResponseEvents(
  response: Response,
  signal?: AbortSignal,
  idleTimeoutMs = 120_000
): AsyncGenerator<ChatStreamEvent> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  const usageState: StreamUsageState = { anthropicInputTokens: 0 }

  function* drainStreamBuffer(final = false): Generator<ChatStreamEvent> {
    const separatorPattern = /\r?\n\r?\n/
    let match = buffer.match(separatorPattern)

    while (match?.index !== undefined) {
      const eventBlock = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      for (const data of getSseEventData(eventBlock)) {
        if (data.trim() === '[DONE]') {
          finished = true
          return
        }
        const failure = readStreamError(data)
        if (failure) throw failure
        const parsed = parseStreamDataPayload(data, usageState)
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
      if (data === '[DONE]') {
        finished = true
        return
      }
      const failure = readStreamError(data)
      if (failure) throw failure
      const parsed = parseStreamDataPayload(data, usageState)
      if (parsed) yield parsed
    }

    if (!final || !buffer.trim()) return
    const tail = buffer
    buffer = ''
    for (const data of getSseEventData(tail)) {
      if (data.trim() === '[DONE]') {
        finished = true
        return
      }
      const failure = readStreamError(data)
      if (failure) throw failure
      const parsed = parseStreamDataPayload(data, usageState)
      if (parsed) yield parsed
    }
  }

  while (!finished) {
    const { done, value } = await readChatStreamChunk(reader, signal, idleTimeoutMs)
    if (done) {
      buffer += decoder.decode()
      for (const event of drainStreamBuffer(true)) yield event
      break
    }
    buffer += decoder.decode(value, { stream: true })
    for (const event of drainStreamBuffer()) yield event
  }
  if (finished) void reader.cancel().catch(() => undefined)
}
