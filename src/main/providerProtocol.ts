/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ApiProvider, ProviderProtocol } from '../shared/types'
import { PROVIDER_TEMPLATES } from '../shared/providers.ts'

/**
 * "openai" covers every /chat/completions-compatible gateway, which is what
 * almost all Chinese and aggregator providers expose. The two native protocols
 * exist because going through their OpenAI shim loses features the real APIs
 * have (prompt caching, thinking blocks, native multimodal parts, and
 * per-model token accounting).
 */
export type { ProviderProtocol }

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096

export type ProtocolContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ProtocolChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ProtocolContentPart[]
}

export interface ProtocolChatOptions {
  model: string
  messages: ProtocolChatMessage[]
  temperature?: number
  maxTokens?: number
  stream?: boolean
  jsonMode?: boolean
  reasoningEffort?: string
}

export interface ProtocolRequestSpec {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

/**
 * Providers configured before the `protocol` field existed have no value to
 * read, so the endpoint decides. The rule matters: an Anthropic key sent to
 * /chat/completions returns 404, and a Gemini base URL that already ends in
 * /openai must stay on the OpenAI shim.
 */
export function resolveProviderProtocol(
  provider: Pick<ApiProvider, 'apiBaseUrl'> & { protocol?: ProviderProtocol; templateId?: string }
): ProviderProtocol {
  const explicit = provider.protocol
  if (explicit === 'openai' || explicit === 'anthropic' || explicit === 'gemini') return explicit

  // A pinned template wins over the endpoint: people routinely point the
  // Anthropic template at a proxy, and the proxy still speaks Messages.
  const template = provider.templateId
    ? PROVIDER_TEMPLATES.find((item) => item.id === provider.templateId)
    : undefined
  if (template?.protocol) return template.protocol

  let parsed: URL
  try {
    parsed = new URL(provider.apiBaseUrl.trim())
  } catch {
    return 'openai'
  }

  const host = parsed.hostname.toLowerCase()
  if (host === 'api.anthropic.com' || host.endsWith('.anthropic.com')) return 'anthropic'
  if (host === 'generativelanguage.googleapis.com') {
    return /\/openai\/?$/i.test(parsed.pathname) ? 'openai' : 'gemini'
  }
  return 'openai'
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function joinUrl(base: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${normalizeBaseUrl(base)}${suffix}`
}

function splitDataUrl(value: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/is.exec(value.trim())
  if (!match) return null
  const mediaType = (match[1] || 'image/png').trim().toLowerCase()
  const data = match[2].replace(/\s+/g, '')
  if (!data) return null
  return { mediaType, data }
}

function contentParts(content: string | ProtocolContentPart[]): ProtocolContentPart[] {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : []
  return content.filter((part) => {
    if (part.type === 'text') return part.text.trim().length > 0
    return Boolean(part.image_url.url)
  })
}

function textOf(parts: ProtocolContentPart[]): string {
  return parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

interface AnthropicBlock {
  type: string
  text?: string
  source?: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string }
}

function toAnthropicBlocks(parts: ProtocolContentPart[]): AnthropicBlock[] {
  const blocks: AnthropicBlock[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    const url = part.image_url.url.trim()
    const dataUrl = splitDataUrl(url)
    if (dataUrl) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: dataUrl.mediaType, data: dataUrl.data }
      })
      continue
    }
    if (/^https?:\/\//i.test(url)) {
      blocks.push({ type: 'image', source: { type: 'url', url } })
    }
    // Anything else (a bare file path, a clipboard id) is not fetchable by the
    // API. Dropping it is better than sending a body the server will reject.
  }
  return blocks
}

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

function toGeminiParts(parts: ProtocolContentPart[]): GeminiPart[] {
  const converted: GeminiPart[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      converted.push({ text: part.text })
      continue
    }
    const dataUrl = splitDataUrl(part.image_url.url.trim())
    if (dataUrl) converted.push({ inlineData: { mimeType: dataUrl.mediaType, data: dataUrl.data } })
  }
  return converted
}

/** Anthropic requires strictly alternating roles; Gemini merges better too. */
function mergeAdjacent<T>(items: T[], roleOf: (item: T) => string, merge: (left: T, right: T) => T): T[] {
  const merged: T[] = []
  for (const item of items) {
    const previous = merged[merged.length - 1]
    if (previous && roleOf(previous) === roleOf(item)) {
      merged[merged.length - 1] = merge(previous, item)
      continue
    }
    merged.push(item)
  }
  return merged
}

interface AnthropicTurn {
  role: 'user' | 'assistant'
  content: AnthropicBlock[]
}

function buildAnthropicMessages(messages: ProtocolChatMessage[]): {
  system: string
  messages: AnthropicTurn[]
} {
  const systemChunks: string[] = []
  const turns: AnthropicTurn[] = []

  for (const message of messages) {
    const parts = contentParts(message.content)
    if (parts.length === 0) continue
    if (message.role === 'system') {
      systemChunks.push(textOf(parts))
      continue
    }
    const blocks = toAnthropicBlocks(parts)
    if (blocks.length === 0) continue
    turns.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: blocks })
  }

  const merged = mergeAdjacent(turns, (turn) => turn.role, (left, right) => ({
    role: left.role,
    content: [...left.content, ...right.content]
  }))

  // The Messages API rejects an empty `messages` array and a leading assistant
  // turn. A system-only request (some internal one-shot calls) still needs to
  // carry its instruction, so fold it into a single user turn instead.
  if (merged.length === 0) {
    return {
      system: systemChunks.join('\n\n'),
      messages: [{ role: 'user', content: [{ type: 'text', text: systemChunks.join('\n\n') || 'Continue.' }] }]
    }
  }
  if (merged[0].role === 'assistant') {
    merged.unshift({ role: 'user', content: [{ type: 'text', text: 'Continue the conversation.' }] })
  }

  return { system: systemChunks.join('\n\n').trim(), messages: merged }
}

interface GeminiTurn {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

function buildGeminiContents(messages: ProtocolChatMessage[]): {
  systemInstruction?: { parts: GeminiPart[] }
  contents: GeminiTurn[]
} {
  const systemChunks: string[] = []
  const turns: GeminiTurn[] = []

  for (const message of messages) {
    const parts = contentParts(message.content)
    if (parts.length === 0) continue
    if (message.role === 'system') {
      systemChunks.push(textOf(parts))
      continue
    }
    const geminiParts = toGeminiParts(parts)
    if (geminiParts.length === 0) continue
    turns.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: geminiParts })
  }

  const merged = mergeAdjacent(turns, (turn) => turn.role, (left, right) => ({
    role: left.role,
    parts: [...left.parts, ...right.parts]
  }))

  const system = systemChunks.join('\n\n').trim()
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: merged.length > 0 ? merged : [{ role: 'user' as const, parts: [{ text: 'Continue.' }] }]
  }
}

function clampAnthropicTemperature(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

export function buildChatRequest(
  protocol: ProviderProtocol,
  provider: Pick<ApiProvider, 'apiBaseUrl' | 'apiKey' | 'chatCompletionsPath'>,
  options: ProtocolChatOptions
): ProtocolRequestSpec {
  const stream = options.stream === true

  if (protocol === 'anthropic') {
    const { system, messages } = buildAnthropicMessages(options.messages)
    return {
      url: joinUrl(provider.apiBaseUrl, '/messages'),
      headers: {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
        ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {})
      },
      body: {
        model: options.model,
        max_tokens: Math.max(1, Math.round(options.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS)),
        messages,
        ...(system ? { system } : {}),
        ...(clampAnthropicTemperature(options.temperature) !== undefined
          ? { temperature: clampAnthropicTemperature(options.temperature) }
          : {}),
        stream
      }
    }
  }

  if (protocol === 'gemini') {
    const { systemInstruction, contents } = buildGeminiContents(options.messages)
    const action = stream ? 'streamGenerateContent' : 'generateContent'
    const query = stream ? '?alt=sse' : ''
    return {
      url: joinUrl(provider.apiBaseUrl, `/models/${encodeURIComponent(options.model)}:${action}${query}`),
      headers: {
        'content-type': 'application/json',
        ...(provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {})
      },
      body: {
        ...(systemInstruction ? { systemInstruction } : {}),
        contents,
        generationConfig: {
          ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
          ...(typeof options.maxTokens === 'number' ? { maxOutputTokens: Math.max(1, Math.round(options.maxTokens)) } : {}),
          ...(options.jsonMode ? { responseMimeType: 'application/json' } : {})
        }
      }
    }
  }

  const path = provider.chatCompletionsPath ?? '/chat/completions'
  return {
    url: joinUrl(provider.apiBaseUrl, path),
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: {
      model: options.model,
      messages: options.messages,
      ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
      ...(typeof options.maxTokens === 'number' ? { max_tokens: Math.round(options.maxTokens) } : {}),
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      stream
    }
  }
}

function textFromGeminiResponse(payload: unknown): string {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> })
    ?.candidates
  const parts = candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('')
}

export function readCompletionText(protocol: ProviderProtocol, payload: unknown): string {
  if (protocol === 'anthropic') {
    const blocks = (payload as { content?: Array<{ type?: unknown; text?: unknown }> })?.content
    if (!Array.isArray(blocks)) return ''
    return blocks
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => String(block.text))
      .join('')
  }
  if (protocol === 'gemini') return textFromGeminiResponse(payload)

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> })?.choices
  const content = choices?.[0]?.message?.content ?? choices?.[0]?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : typeof (part as { text?: unknown })?.text === 'string' ? String((part as { text: string }).text) : ''))
      .join('')
  }
  return ''
}

export function readCompletionUsage(protocol: ProviderProtocol, payload: unknown): {
  inputTokens: number
  outputTokens: number
  totalTokens: number
} | undefined {
  if (protocol === 'anthropic') {
    const usage = (payload as { usage?: { input_tokens?: unknown; output_tokens?: unknown } })?.usage
    if (!usage) return undefined
    const input = Math.max(0, Math.round(Number(usage.input_tokens ?? 0) || 0))
    const output = Math.max(0, Math.round(Number(usage.output_tokens ?? 0) || 0))
    if (!input && !output) return undefined
    return { inputTokens: input, outputTokens: output, totalTokens: input + output }
  }
  if (protocol === 'gemini') {
    const usage = (payload as { usageMetadata?: Record<string, unknown> })?.usageMetadata
    if (!usage) return undefined
    const input = Math.max(0, Math.round(Number(usage.promptTokenCount ?? 0) || 0))
    const output = Math.max(0, Math.round(Number(usage.candidatesTokenCount ?? 0) || 0))
    const total = Math.max(0, Math.round(Number(usage.totalTokenCount ?? input + output) || 0))
    if (!input && !output && !total) return undefined
    return { inputTokens: input, outputTokens: output, totalTokens: total || input + output }
  }

  const usage = (payload as { usage?: Record<string, unknown> })?.usage
  if (!usage) return undefined
  const input = Math.max(0, Math.round(Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0))
  const output = Math.max(0, Math.round(Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0))
  const total = Math.max(0, Math.round(Number(usage.total_tokens ?? input + output) || 0))
  if (!input && !output && !total) return undefined
  return { inputTokens: input, outputTokens: output, totalTokens: total || input + output }
}

export function buildModelListRequest(
  protocol: ProviderProtocol,
  provider: Pick<ApiProvider, 'apiBaseUrl' | 'apiKey' | 'modelsPath'>
): { url: string; headers: Record<string, string> } {
  if (protocol === 'anthropic') {
    return {
      url: joinUrl(provider.apiBaseUrl, '/models?limit=100'),
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        ...(provider.apiKey ? { 'x-api-key': provider.apiKey } : {})
      }
    }
  }
  if (protocol === 'gemini') {
    return {
      url: joinUrl(provider.apiBaseUrl, '/models?pageSize=200'),
      headers: {
        ...(provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {})
      }
    }
  }
  return {
    url: joinUrl(provider.apiBaseUrl, provider.modelsPath ?? '/models'),
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
    }
  }
}

export interface ProviderModelRecord {
  id: string
  name?: string
  ownedBy?: string
}

/**
 * Reads the model list of each wire protocol into one shape. Gemini needs the
 * "models/" prefix stripped because the generateContent path adds it back,
 * and it is the one place where a duplicated prefix would break every call.
 */
export function readModelRecords(protocol: ProviderProtocol, payload: unknown): ProviderModelRecord[] {
  const records: ProviderModelRecord[] = []

  if (protocol === 'gemini') {
    const models = (payload as { models?: unknown })?.models
    if (!Array.isArray(models)) return records
    for (const item of models) {
      const id = String((item as { name?: unknown })?.name ?? '').trim().replace(/^models\//, '')
      if (!id) continue
      const displayName = String((item as { displayName?: unknown })?.displayName ?? '').trim()
      records.push({ id, name: displayName || id })
    }
    return dedupeRecords(records)
  }

  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? ((payload as { data: unknown[] }).data ?? [])
      : []

  for (const item of source) {
    if (typeof item === 'string') {
      records.push({ id: item.trim() })
      continue
    }
    const record = item as { id?: unknown; model?: unknown; name?: unknown; owned_by?: unknown; ownedBy?: unknown } | null
    const id = String(record?.id ?? record?.model ?? record?.name ?? '').trim()
    const name = typeof record?.name === 'string' ? record.name.trim() : ''
    const ownedBy = String(record?.owned_by ?? record?.ownedBy ?? '').trim()
    records.push({ id, ...(name ? { name } : {}), ...(ownedBy ? { ownedBy } : {}) })
  }
  return dedupeRecords(records)
}

function dedupeRecords(records: ProviderModelRecord[]): ProviderModelRecord[] {
  const seen = new Set<string>()
  const unique: ProviderModelRecord[] = []
  for (const record of records) {
    if (!record.id || seen.has(record.id)) continue
    seen.add(record.id)
    unique.push(record)
  }
  return unique
}
