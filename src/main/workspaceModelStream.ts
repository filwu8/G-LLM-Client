/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { extractTextContent } from './chatStreamParser.ts'

export interface WorkspaceToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface WorkspaceModelMessage {
  content?: string | null
  tool_calls?: WorkspaceToolCall[]
  reasoningCharacters?: number
  finishReason?: string | null
}

type ReadWorkspaceStreamChunk = (
  reader: ReadableStreamDefaultReader<Uint8Array>
) => Promise<ReadableStreamReadResult<Uint8Array>>

interface WorkspaceStreamToolCall {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface WorkspaceStreamPayload {
  error?: { message?: unknown }
  choices?: Array<{
    delta?: {
      content?: unknown
      reasoning_content?: unknown
      tool_calls?: WorkspaceStreamToolCall[]
    }
    message?: {
      content?: unknown
      reasoning_content?: unknown
      tool_calls?: WorkspaceStreamToolCall[]
    }
    finish_reason?: unknown
  }>
}

function getSseData(eventBlock: string): string[] {
  const dataLines = eventBlock
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())

  if (dataLines.length > 0) return [dataLines.join('\n')]

  const trimmed = eventBlock.trim()
  // SSE comments (often used as keep-alive heartbeats, e.g. `: PING`) are
  // transport activity, not model payloads. In particular, never surface a
  // comment as content through the raw-record compatibility path below.
  if (!trimmed || trimmed.startsWith(':')) return []
  return trimmed ? [trimmed] : []
}

const CHAT_COMPLETIONS_FINISH_REASONS = new Set([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  // Kept for compatibility with older Chat Completions providers.
  'function_call'
])

function isCompleteDataRecord(data: string): boolean {
  const trimmed = data.trim()
  if (!trimmed || trimmed === '[DONE]') return true
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function appendStreamFragment(current: string, fragment: string): string {
  if (!fragment) return current
  if (!current || fragment.startsWith(current)) return fragment
  if (fragment === current) return current
  return current + fragment
}

/**
 * Incrementally aggregates an OpenAI-compatible workspace-agent response.
 * Besides standard SSE blank lines, some gateways terminate every complete
 * `data:` record with only one newline. Holding those records until the socket
 * closes makes workspace conversations appear to hang indefinitely.
 */
export class WorkspaceModelStreamParser {
  private readonly toolCalls = new Map<number, WorkspaceToolCall>()
  private content = ''
  private reasoningCharacters = 0
  private finishReason: string | null = null
  private buffer = ''
  private isFinished = false
  private toolCallsComplete = false

  get finished(): boolean {
    return this.isFinished
  }

  get hasValidFinishReason(): boolean {
    return this.finishReason !== null && CHAT_COMPLETIONS_FINISH_REASONS.has(this.finishReason)
  }

  push(text: string, final = false): void {
    if (this.isFinished) return
    this.buffer += text
    this.drainStandardEvents()
    if (!this.isFinished) this.drainSingleLineRecords()

    if (final && !this.isFinished && this.buffer.trim()) {
      const tail = this.buffer
      this.buffer = ''
      this.consumeEventBlock(tail)
    }
  }

  result(): WorkspaceModelMessage | undefined {
    // Partial streamed calls are not executable. Only expose a call once the
    // Chat Completions protocol has explicitly ended the tool-call turn.
    const calls = this.toolCallsComplete
      ? Array.from(this.toolCalls.entries())
          .sort(([left], [right]) => left - right)
          .map(([, call]) => call)
          // A protocol-finished call with malformed JSON still needs a
          // correlated tool error result. JSON is parsed only by the agent
          // after the stream completion marker, never while fragments arrive.
          .filter(hasToolCallIdentity)
      : []

    if (!this.content && calls.length === 0 && this.reasoningCharacters === 0) return undefined
    return {
      content: this.content || null,
      tool_calls: calls.length > 0 ? calls : undefined,
      reasoningCharacters: this.reasoningCharacters,
      finishReason: this.finishReason
    }
  }

  private drainStandardEvents(): void {
    let separator = this.buffer.match(/\r?\n\r?\n/)
    while (!this.isFinished && separator?.index !== undefined) {
      const eventBlock = this.buffer.slice(0, separator.index)
      this.buffer = this.buffer.slice(separator.index + separator[0].length)
      this.consumeEventBlock(eventBlock)
      separator = this.buffer.match(/\r?\n\r?\n/)
    }
  }

  private drainSingleLineRecords(): void {
    while (!this.isFinished) {
      const lineBreak = this.buffer.match(/\r?\n/)
      if (lineBreak?.index === undefined) return

      const rawLine = this.buffer.slice(0, lineBreak.index)
      const trimmedLine = rawLine.trim()
      if (!trimmedLine || trimmedLine.startsWith(':') || /^(event|id|retry):/.test(trimmedLine)) {
        this.buffer = this.buffer.slice(lineBreak.index + lineBreak[0].length)
        continue
      }

      const data = trimmedLine.startsWith('data:')
        ? trimmedLine.slice(5).trimStart()
        : trimmedLine
      if (!isCompleteDataRecord(data)) return

      this.buffer = this.buffer.slice(lineBreak.index + lineBreak[0].length)
      this.consumeData(data)
    }
  }

  private consumeEventBlock(eventBlock: string): void {
    for (const data of getSseData(eventBlock)) {
      this.consumeData(data)
      if (this.isFinished) return
    }
  }

  private consumeData(data: string): void {
    const trimmed = data.trim()
    if (!trimmed) return
    if (trimmed === '[DONE]') {
      this.toolCallsComplete = true
      this.isFinished = true
      return
    }

    let payload: WorkspaceStreamPayload
    try {
      payload = JSON.parse(trimmed) as WorkspaceStreamPayload
    } catch {
      return
    }
    if (payload.error) throw new Error(String(payload.error.message ?? '模型流式响应失败'))

    for (const choice of payload.choices ?? []) {
      const message = choice.delta ?? choice.message
      this.content += extractTextContent(message?.content)
      this.reasoningCharacters += extractTextContent(message?.reasoning_content).length
      let responseFinished = false
      if (typeof choice.finish_reason === 'string') {
        this.finishReason = choice.finish_reason
        responseFinished = CHAT_COMPLETIONS_FINISH_REASONS.has(choice.finish_reason)
        if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') this.toolCallsComplete = true
      }

      for (const part of message?.tool_calls ?? []) {
        const index = Number.isInteger(part.index) && Number(part.index) >= 0
          ? Number(part.index)
          : this.resolveToolCallIndex(part.id)
        const existing = this.toolCalls.get(index) ?? {
          id: part.id ?? '',
          type: 'function' as const,
          function: { name: '', arguments: '' }
        }
        if (part.id) existing.id = appendStreamFragment(existing.id, part.id)
        if (part.function?.name) {
          existing.function.name = appendStreamFragment(existing.function.name, part.function.name)
        }
        if (part.function?.arguments) {
          existing.function.arguments = appendStreamFragment(existing.function.arguments, part.function.arguments)
        }
        this.toolCalls.set(index, existing)
      }
      if (responseFinished) {
        this.isFinished = true
        return
      }
    }
  }

  private resolveToolCallIndex(id: string | undefined): number {
    if (id) {
      for (const [index, call] of this.toolCalls) {
        if (call.id === id) return index
      }
      return this.nextToolCallIndex()
    }
    if (this.toolCalls.size === 1) return this.toolCalls.keys().next().value ?? 0
    return this.nextToolCallIndex()
  }

  private nextToolCallIndex(): number {
    let index = 0
    while (this.toolCalls.has(index)) index += 1
    return index
  }
}

function hasToolCallIdentity(call: WorkspaceToolCall): boolean {
  return Boolean(call.id.trim() && call.function.name.trim())
}

/** Read until the protocol is complete rather than waiting for the provider to
 * close its HTTP connection after `[DONE]`. The caller can inject its existing
 * timeout/abort-aware reader for production use.
 */
export async function readWorkspaceModelEventStream(
  body: ReadableStream<Uint8Array>,
  readChunk: ReadWorkspaceStreamChunk = (reader) => reader.read()
): Promise<WorkspaceModelMessage | undefined> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = new WorkspaceModelStreamParser()

  while (!parser.finished) {
    const { done, value } = await readChunk(reader)
    if (done) {
      parser.push(decoder.decode(), true)
      if (!parser.finished && !parser.hasValidFinishReason) {
        throw new Error('模型流式响应未完整结束：连接在收到 Chat Completions 完成标记前关闭')
      }
      break
    }
    parser.push(decoder.decode(value, { stream: true }))
  }
  if (parser.finished) void reader.cancel().catch(() => undefined)
  return parser.result()
}
