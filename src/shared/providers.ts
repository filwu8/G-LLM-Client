/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ApiProvider, ProviderModel, ProviderTemplate, ProviderTemplateId } from './types'
import { inferModelCapabilities, inferModelType } from './modelCapabilities.ts'

export const DEFAULT_PROVIDER_ID = 'provider_gllm'
export const PROVIDER_MODEL_CATALOG_TTL_MS = 6 * 60 * 60 * 1000

export function isLocalNetworkApiBaseUrl(value: string): boolean {
  let hostname: string
  try {
    hostname = new URL(value.trim()).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return false
  }

  if (!hostname) return false
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.lan') ||
    !hostname.includes('.')
  ) return true

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some((octet) => octet > 255)) return false
    const [first, second] = octets
    return first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
  }

  if (hostname === '::1') return true
  const firstIpv6Group = hostname.split(':', 1)[0]
  const firstIpv6Value = Number.parseInt(firstIpv6Group, 16)
  return Number.isFinite(firstIpv6Value) && (
    (firstIpv6Value >= 0xfc00 && firstIpv6Value <= 0xfdff) ||
    (firstIpv6Value >= 0xfe80 && firstIpv6Value <= 0xfebf)
  )
}

export function isProviderApiKeyMissing(provider: Pick<ApiProvider, 'apiBaseUrl' | 'apiKey' | 'requiresApiKey'>): boolean {
  return provider.requiresApiKey && !provider.apiKey.trim() && !isLocalNetworkApiBaseUrl(provider.apiBaseUrl)
}

export function isOfficialGllmApiProvider(provider: ApiProvider): boolean {
  try {
    const url = new URL(provider.apiBaseUrl)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.origin === 'https://llm.gprophet.com' && pathname === '/v1'
  } catch {
    return false
  }
}

export function resolveProviderModelId(provider: ApiProvider, requestedModel?: string): string {
  const requested = requestedModel?.trim() ?? ''
  const configuredDefault = provider.defaultModel.trim()

  // Custom OpenAI-compatible providers may support models that their catalog
  // endpoint does not enumerate, so preserve manually entered model IDs there.
  if (!isOfficialGllmApiProvider(provider)) {
    return requested || configuredDefault || provider.models[0]?.id || ''
  }

  const available = new Set(provider.models.map((model) => model.id))
  if (requested && available.has(requested)) return requested
  if (configuredDefault && available.has(configuredDefault)) return configuredDefault
  return provider.models[0]?.id || configuredDefault || requested
}

export function applyFetchedProviderModels(
  provider: ApiProvider,
  models: ProviderModel[],
  modelsUpdatedAt = Date.now()
): ApiProvider {
  const next = { ...provider, models, modelsUpdatedAt }
  return {
    ...next,
    defaultModel: resolveProviderModelId(next, provider.defaultModel)
  }
}

export function shouldRefreshProviderModels(provider: ApiProvider, now = Date.now()): boolean {
  if (!isOfficialGllmApiProvider(provider) || !provider.apiKey.trim()) return false
  if (!provider.modelsUpdatedAt) return true
  return now - provider.modelsUpdatedAt >= PROVIDER_MODEL_CATALOG_TTL_MS
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'gllm',
    name: 'G-LLM',
    description: 'G-LLM 默认网关',
    category: 'default',
    apiBaseUrl: 'https://llm.gprophet.com/v1',
    defaultModel: 'g-llm-chat',
    suggestedModels: ['g-llm-chat'],
    requiresApiKey: true
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI 兼容',
    description: '兼容 /chat/completions 的自定义网关',
    category: 'default',
    apiBaseUrl: 'https://api.example.com/v1',
    defaultModel: 'model-name',
    suggestedModels: ['model-name'],
    requiresApiKey: true
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI 官方兼容接口',
    category: 'global',
    apiBaseUrl: 'https://api.openai.com/v1',
    imageGenerationsPath: '/images/generations',
    defaultModel: 'gpt-4.1-mini',
    suggestedModels: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-image-1', 'text-embedding-3-large'],
    requiresApiKey: true
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    description: 'Gemini OpenAI 兼容接口',
    category: 'global',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
    suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'text-embedding-004'],
    requiresApiKey: true
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek 兼容接口模板',
    category: 'china',
    apiBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    requiresApiKey: true
  },
  {
    id: 'dashscope',
    name: '阿里云百炼',
    description: '通义千问 DashScope 兼容模式',
    category: 'china',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    suggestedModels: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-vl-plus', 'text-embedding-v4'],
    requiresApiKey: true
  },
  {
    id: 'moonshot',
    name: 'Moonshot / Kimi',
    description: 'Kimi OpenAI 兼容接口',
    category: 'china',
    apiBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    suggestedModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2.6'],
    requiresApiKey: true
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    description: '智谱 OpenAI 兼容接口',
    category: 'china',
    apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.5',
    suggestedModels: ['glm-4.5', 'glm-4.5-air', 'glm-4-plus', 'glm-4v'],
    requiresApiKey: true
  },
  {
    id: 'volcengine-ark',
    name: '火山方舟 / 豆包',
    description: '火山方舟 OpenAI 兼容接口',
    category: 'china',
    apiBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-1-6',
    suggestedModels: ['doubao-seed-1-6', 'doubao-seed-1-6-thinking', 'doubao-vision-pro'],
    requiresApiKey: true
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    description: '硅基流动聚合模型接口',
    category: 'aggregator',
    apiBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    suggestedModels: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen3-235B-A22B',
      'Qwen/Qwen2.5-VL-72B-Instruct'
    ],
    requiresApiKey: true
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: '多模型聚合与路由平台',
    category: 'aggregator',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1-mini',
    suggestedModels: ['openai/gpt-4.1-mini', 'google/gemini-2.5-flash', 'anthropic/claude-3.5-sonnet', 'deepseek/deepseek-chat'],
    requiresApiKey: true
  },
  {
    id: 'groq',
    name: 'Groq',
    description: '高速推理 OpenAI 兼容接口',
    category: 'global',
    apiBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    suggestedModels: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'qwen-qwq-32b'],
    requiresApiKey: true
  },
  {
    id: 'mistral',
    name: 'Mistral',
    description: 'Mistral Chat Completions 接口',
    category: 'global',
    apiBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-small-latest',
    suggestedModels: ['mistral-small-latest', 'mistral-large-latest', 'pixtral-large-latest', 'codestral-latest'],
    requiresApiKey: true
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    description: 'xAI OpenAI 兼容接口',
    category: 'global',
    apiBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-3-mini',
    suggestedModels: ['grok-3-mini', 'grok-3', 'grok-2-vision-1212'],
    requiresApiKey: true
  },
  {
    id: 'together',
    name: 'Together AI',
    description: '开源模型托管与兼容接口',
    category: 'aggregator',
    apiBaseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    suggestedModels: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
      'deepseek-ai/DeepSeek-V3'
    ],
    requiresApiKey: true
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'Sonar 搜索增强模型',
    category: 'global',
    apiBaseUrl: 'https://api.perplexity.ai',
    modelsPath: '/v1/models',
    defaultModel: 'sonar-pro',
    suggestedModels: ['sonar-pro', 'sonar', 'sonar-reasoning'],
    requiresApiKey: true
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: '本地 Ollama OpenAI 兼容接口',
    category: 'local',
    apiBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    suggestedModels: ['llama3.1', 'qwen2.5', 'deepseek-r1', 'gemma3'],
    requiresApiKey: false
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    description: '本地 LM Studio 兼容接口',
    category: 'local',
    apiBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    suggestedModels: ['local-model', 'qwen2.5-7b-instruct', 'llama-3.1-8b-instruct'],
    requiresApiKey: false
  },
  {
    id: 'local-compatible',
    name: '本地兼容服务',
    description: '本地或内网 OpenAI-compatible 服务',
    category: 'local',
    apiBaseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    suggestedModels: ['llama3.1', 'qwen2.5', 'deepseek-r1'],
    requiresApiKey: false
  }
]

export const DEFAULT_PROVIDER: ApiProvider = createProviderFromTemplate('gllm', DEFAULT_PROVIDER_ID)

export function getProviderTemplate(id: ProviderTemplateId): ProviderTemplate {
  return PROVIDER_TEMPLATES.find((template) => template.id === id) ?? PROVIDER_TEMPLATES[0]
}

export function createProviderFromTemplate(templateId: ProviderTemplateId, id = createProviderId()): ApiProvider {
  const template = getProviderTemplate(templateId)
  const now = Date.now()

  return {
    id,
    templateId: template.id,
    name: template.name,
    apiBaseUrl: template.apiBaseUrl,
    chatCompletionsPath: template.chatCompletionsPath,
    imageGenerationsPath: template.imageGenerationsPath,
    modelsPath: template.modelsPath,
    apiKey: '',
    defaultModel: template.defaultModel,
    models: template.suggestedModels.map((id) => ({ id, capabilities: inferModelCapabilities(id), type: inferModelType(id) })),
    requiresApiKey: template.requiresApiKey,
    createdAt: now,
    updatedAt: now
  }
}

export function getProviderById(id: string, providers: ApiProvider[]): ApiProvider {
  return providers.find((provider) => provider.id === id) ?? providers[0] ?? DEFAULT_PROVIDER
}

function createProviderId(): string {
  return `provider_${Date.now()}_${Math.random().toString(16).slice(2)}`
}
