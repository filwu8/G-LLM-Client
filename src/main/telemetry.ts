/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import os from 'node:os'

import type { ApiProvider, ChatRequest } from '../shared/types'
import { normalizeModelCapabilities } from '../shared/modelCapabilities'
import { getInstallationId, getSettings } from './storage'

const TELEMETRY_ENDPOINT = process.env.GLLM_TELEMETRY_ENDPOINT || 'https://llm.gprophet.com/v1/events'
const TELEMETRY_TIMEOUT_MS = 2500
const TELEMETRY_ALLOWED_EVENTS = new Set([
  'app_started',
  'telemetry_enabled',
  'telemetry_disabled',
  'provider_added',
  'provider_updated',
  'provider_models_refreshed',
  'provider_models_refresh_failed',
  'chat_started',
  'chat_completed',
  'chat_failed'
])
const TELEMETRY_ALLOWED_PROPERTIES = new Set([
  'provider_kind',
  'provider_template',
  'model_capabilities',
  'requires_api_key',
  'model_count',
  'purpose',
  'web_search_enabled',
  'has_knowledge_refs',
  'has_assistant_memory',
  'image_attachment_count',
  'file_attachment_count',
  'message_count',
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'finish_reason',
  'truncated',
  'error_category'
])
const TELEMETRY_BLOCKED_PROPERTY_PATTERN =
  /prompt|content|message|api_?key|base_?url|file_?name|file_?content|screenshot|knowledge|memory_?content|邮箱|手机号|真实姓名|聊天原文|上传文件内容/i

type TelemetryPropertyValue = string | number | boolean | null | undefined | string[]
type TelemetryProperties = Record<string, TelemetryPropertyValue>

function sanitizeProperties(properties: TelemetryProperties = {}): Record<string, string | number | boolean | null | string[]> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => TELEMETRY_ALLOWED_PROPERTIES.has(key) && !TELEMETRY_BLOCKED_PROPERTY_PATTERN.test(key))
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        if (Array.isArray(value)) return [key, value.slice(0, 12).map((item) => item.slice(0, 40))]
        if (typeof value === 'string') return [key, value.slice(0, 160)]
        if (typeof value === 'number') return [key, Number.isFinite(value) ? value : 0]
        return [key, value ?? null]
      })
  )
}

function getProviderKind(provider: ApiProvider): string {
  if (provider.templateId === 'gllm') return 'gllm'
  if (provider.templateId === 'local-compatible' || provider.templateId === 'ollama' || provider.templateId === 'lm-studio') {
    return 'local'
  }
  if (provider.templateId === 'openai-compatible') return 'custom'
  return provider.templateId
}

function getModelCapabilitySummary(provider: ApiProvider): string[] {
  const currentModel = provider.models.find((model) => model.id === provider.defaultModel) ?? { id: provider.defaultModel }
  return normalizeModelCapabilities(currentModel)
}

export function getProviderTelemetryProperties(provider: ApiProvider): TelemetryProperties {
  return {
    provider_kind: getProviderKind(provider),
    provider_template: provider.templateId,
    model_capabilities: getModelCapabilitySummary(provider),
    requires_api_key: provider.requiresApiKey,
    model_count: provider.models.length
  }
}

export function getChatTelemetryProperties(request: ChatRequest): TelemetryProperties {
  const lastUserMessage = [...request.messages].reverse().find((message) => message.role === 'user')
  const attachments = lastUserMessage?.attachments ?? []
  const imageAttachmentCount = attachments.filter((attachment) => attachment.kind === 'image').length
  const fileAttachmentCount = attachments.filter((attachment) => attachment.kind !== 'image').length

  return {
    ...getProviderTelemetryProperties(request.provider),
    purpose: request.purpose ?? 'chat',
    web_search_enabled: Boolean(request.webSearchEnabled),
    has_knowledge_refs: Boolean(lastUserMessage?.knowledgeRefs?.length),
    has_assistant_memory: Boolean(request.assistantMemories?.some((memory) => memory.enabled)),
    image_attachment_count: imageAttachmentCount,
    file_attachment_count: fileAttachmentCount,
    message_count: request.messages.length
  }
}

export function getErrorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (/api key|apikey|unauthorized|401|403|密钥|鉴权|认证/.test(message)) return 'auth'
  if (/429|rate limit|quota|余额|限额/.test(message)) return 'rate_limit'
  if (/network|fetch failed|timeout|econn|dns|socket|网络/.test(message)) return 'network'
  if (/model|unsupported|not found|404|模型|不支持|400|422|provider|请求失败|upstream|上游/.test(message)) {
    return 'upstream'
  }
  return 'unknown'
}

export async function trackTelemetryEvent(name: string, properties: TelemetryProperties = {}): Promise<void> {
  if (!TELEMETRY_ALLOWED_EVENTS.has(name)) return
  if (!getSettings().telemetryEnabled) return

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TELEMETRY_TIMEOUT_MS)

  try {
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `G-LLM/${app.getVersion()} (${process.platform}; ${process.arch})`
      },
      body: JSON.stringify({
        version: 1,
        event_id: randomUUID(),
        installation_id: getInstallationId(),
        event_name: name,
        occurred_at: new Date().toISOString(),
        app: {
          name: 'G-LLM Desktop',
          version: app.getVersion(),
          packaged: app.isPackaged
        },
        os: {
          platform: process.platform,
          arch: process.arch,
          release: os.release()
        },
        properties: sanitizeProperties(properties)
      }),
      signal: controller.signal
    })
  } catch {
    // Telemetry must never affect the product experience.
  } finally {
    clearTimeout(timer)
  }
}
