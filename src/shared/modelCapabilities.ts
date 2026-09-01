/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ApiProvider, PreparedAttachment, ProviderModel, ProviderModelCapability, ProviderModelType } from './types'

export interface ModelCapabilities {
  imageInput: boolean
  imageGeneration: boolean
  extractedFileText: boolean
}

export const MODEL_TYPE_LABELS: Record<ProviderModelType, string> = {
  chat: '文本对话',
  vision: '视觉理解',
  image: '图片生成',
  embedding: 'Embedding',
  audio: '语音',
  rerank: '重排',
  other: '其他'
}

export const MODEL_CAPABILITY_LABELS: Record<ProviderModelCapability, string> = MODEL_TYPE_LABELS

function collectMetadataText(value: unknown, depth = 0): string[] {
  if (depth > 2 || value === null || value === undefined) return []
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  if (Array.isArray(value)) return value.flatMap((item) => collectMetadataText(item, depth + 1))
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
      key,
      ...collectMetadataText(item, depth + 1)
    ])
  }
  return []
}

export function inferModelType(modelId: string): ProviderModelType {
  const id = modelId.toLowerCase()

  if (/embedding|embed|text-embedding|bge-|gte-|e5-/.test(id)) return 'embedding'
  if (/rerank|ranker|bge-reranker/.test(id)) return 'rerank'
  if (/tts|whisper|audio|speech|transcribe|realtime/.test(id)) return 'audio'
  if (/gpt-image|dall[-.]?e|imagen|image-generation|image-preview|gemini.*image|stable-diffusion|sdxl|flux|midjourney|kolors|wan.*image/.test(id)) {
    return 'image'
  }
  if (/gpt-4o|gpt-4\.1|gpt-5|o\d|vision|vl|qwen.*vl|gemini|claude-3|claude-4|glm-4v|llava|pixtral|grok.*vision|doubao.*vision/.test(id)) {
    return 'vision'
  }
  return 'chat'
}

export function inferModelTypeFromMetadata(modelId: string, metadata?: Record<string, unknown> | null): ProviderModelType {
  if (!metadata) return inferModelType(modelId)

  const text = [modelId, ...collectMetadataText(metadata)].join(' ').toLowerCase()
  if (/embedding|embed|text-embedding|bge-|gte-|e5-/.test(text)) return 'embedding'
  if (/rerank|ranker|bge-reranker/.test(text)) return 'rerank'
  if (/tts|whisper|audio|speech|transcribe|realtime/.test(text)) return 'audio'
  if (/image_generation|image-generation|image-preview|generate_image|gpt-image|dall[-.]?e|imagen|gemini.*image|stable-diffusion|sdxl|flux/.test(text)) {
    return 'image'
  }
  if (/vision|image_input|input_image|multimodal|multi-modal|vl|visual|看图|视觉/.test(text)) return 'vision'
  return inferModelType(modelId)
}

export function inferModelCapabilities(modelId: string): ProviderModelCapability[] {
  const type = inferModelType(modelId)

  if (type === 'vision') return ['chat', 'vision']
  if (type === 'chat') return ['chat']
  if (type === 'image') return ['image']
  if (type === 'embedding') return ['embedding']
  if (type === 'audio') return ['audio']
  if (type === 'rerank') return ['rerank']
  return ['other']
}

export function inferModelCapabilitiesFromMetadata(
  modelId: string,
  metadata?: Record<string, unknown> | null
): ProviderModelCapability[] {
  if (!metadata) return inferModelCapabilities(modelId)

  const text = [modelId, ...collectMetadataText(metadata)].join(' ').toLowerCase()
  const capabilities = new Set<ProviderModelCapability>()

  if (/chat|completion|text_generation|text-generation|generate_text|language|llm|文本|对话/.test(text)) {
    capabilities.add('chat')
  }
  if (/vision|image_input|input_image|multimodal|multi-modal|vl|visual|看图|视觉/.test(text)) {
    capabilities.add('chat')
    capabilities.add('vision')
  }
  if (/image_generation|image-generation|image-preview|generate_image|gpt-image|dall[-.]?e|imagen|gemini.*image|stable-diffusion|sdxl|flux/.test(text)) {
    capabilities.add('image')
  }
  if (/embedding|embed|text-embedding|bge-|gte-|e5-/.test(text)) capabilities.add('embedding')
  if (/rerank|ranker|bge-reranker/.test(text)) capabilities.add('rerank')
  if (/tts|whisper|audio|speech|transcribe|realtime/.test(text)) capabilities.add('audio')

  const idCapabilities = inferModelCapabilities(modelId)
  if (capabilities.size === 0 || idCapabilities.some((capability) => capability !== 'chat')) {
    idCapabilities.forEach((capability) => capabilities.add(capability))
  }

  return normalizeCapabilityList(Array.from(capabilities))
}

export function normalizeModelType(model: ProviderModel): ProviderModelType {
  return model.type ?? normalizeModelCapabilities(model)[0] ?? inferModelType(model.id)
}

export function normalizeModelCapabilities(model: ProviderModel): ProviderModelCapability[] {
  const capabilities: ProviderModelCapability[] = model.capabilities?.length
    ? model.capabilities
    : model.type
      ? model.type === 'vision'
        ? ['chat', 'vision']
        : [model.type]
      : inferModelCapabilities(model.id)

  return normalizeCapabilityList(capabilities)
}

function normalizeCapabilityList(capabilities: ProviderModelCapability[]): ProviderModelCapability[] {
  const expanded: ProviderModelCapability[] = []

  for (const capability of capabilities) {
    if (capability === 'vision') {
      expanded.push('chat', 'vision')
    } else {
      expanded.push(capability)
    }
  }

  const normalized = expanded.filter((capability, index) => expanded.indexOf(capability) === index)
  return normalized.length > 0 ? normalized : ['other']
}

function getDefaultProviderModel(provider: ApiProvider): ProviderModel | undefined {
  return provider.models.find((model) => model.id === provider.defaultModel)
}

export function getModelCapabilities(providerOrModel: ApiProvider | string): ModelCapabilities {
  const modelId = typeof providerOrModel === 'string' ? providerOrModel : providerOrModel.defaultModel
  const capabilities =
    typeof providerOrModel === 'string'
      ? inferModelCapabilities(providerOrModel)
      : normalizeModelCapabilities(getDefaultProviderModel(providerOrModel) ?? { id: modelId })

  return {
    imageInput: capabilities.includes('vision'),
    imageGeneration: capabilities.includes('image'),
    extractedFileText: true
  }
}

/** Select the actual image model while allowing the default chat model to author the prompt. */
export function resolveImageGenerationModel(provider: ApiProvider): ProviderModel | undefined {
  const defaultModel = getDefaultProviderModel(provider)
  if (defaultModel && normalizeModelCapabilities(defaultModel).includes('image')) return defaultModel

  return provider.models.find((model) => normalizeModelCapabilities(model).includes('image'))
}

export function getAttachmentSupportLabel(attachment: PreparedAttachment, capabilities: ModelCapabilities): string {
  if (attachment.kind === 'image') {
    if (!attachment.dataUrl) return '图片过大或读取失败，无法直接识别'
    return capabilities.imageInput ? '模型可识别图片' : '将尝试作为视觉输入发送'
  }

  if (attachment.text) return '已抽取文本'
  return '暂不能解析正文'
}
