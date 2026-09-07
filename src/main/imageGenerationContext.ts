/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ApiProvider, ChatMessage, PreparedAttachment } from '../shared/types.ts'
import {
  normalizeModelCapabilities,
  resolveImageGenerationModel,
  resolveImageGenerationToolModel
} from '../shared/modelCapabilities.ts'
import { isImageGenerationRequest } from './workspaceRequestPolicy.ts'

const generatedImageResponsePattern = /!\[生成图片\s*\d*\]\(|已生成图片|!\[generated image\s*\d*\]\(/i
const imageContinuationPattern = /(?:^|[，,。.!！?？]\s*)(?:请)?(?:再来一张|再生成|重新生成|重做|换一张|继续生成|改成|调整为|修改为|把[^。！？!?\n]{0,24}改成)|\b(?:again|regenerate|generate another|make another|change it to|adjust it to|edit it|revise it)\b/i
const imageQuestionOrFeedbackPattern = /(?:为什么|为何|是否|有没有|有没|收到|看到了吗|区别|差别|怎么样|如何评价|能否辨识|无法辨识)|\b(?:why|did you receive|can you see|what(?:'s| is) the difference|how does|feedback|critique)\b/i
const continuationReferencePattern = /(?:再|重新|继续|之前|刚才|上次|原图|原始|参考|保持|基于|这张|那个|它|同样|改成|调整|修改)|\b(?:again|previous|original|reference|same|based on|this image|it|change|adjust|edit|revise)\b/i

export interface ImageGenerationContext {
  prompt: string
  referenceImages: PreparedAttachment[]
  isContinuation: boolean
}

export interface ImageGenerationTarget {
  model: string
  mode: 'image-api' | 'responses-tool'
}

export function buildImageGenerationRequestBody(
  target: ImageGenerationTarget,
  prompt: string,
  referenceImages: PreparedAttachment[],
  size: string,
  quality: string
): Record<string, unknown> {
  if (target.mode === 'image-api') {
    if (referenceImages.length > 0) throw new Error('REFERENCE_IMAGE_UNSUPPORTED')
    return { model: target.model, prompt, n: 1, size, response_format: 'b64_json' }
  }

  const input = referenceImages.length > 0
    ? [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          ...referenceImages.map((image) => ({ type: 'input_image', image_url: image.dataUrl }))
        ]
      }]
    : prompt
  return {
    model: target.model,
    input,
    tools: [{ type: 'image_generation', size, quality }],
    tool_choice: { type: 'image_generation' },
    stream: false
  }
}

export function resolveImageGenerationTarget(provider: ApiProvider, hasReferenceImages: boolean): ImageGenerationTarget | undefined {
  const defaultModel = provider.models.find((model) => model.id === provider.defaultModel) ?? { id: provider.defaultModel }
  const defaultCapabilities = normalizeModelCapabilities(defaultModel)

  if (hasReferenceImages) {
    const toolModel = resolveImageGenerationToolModel(provider)
    if (toolModel) return { model: toolModel.id, mode: 'responses-tool' }
    const directModel = resolveImageGenerationModel(provider)
    return directModel ? { model: directModel.id, mode: 'image-api' } : undefined
  }

  if (defaultCapabilities.includes('image')) return { model: defaultModel.id, mode: 'image-api' }
  if (defaultCapabilities.includes('image-tool')) return { model: defaultModel.id, mode: 'responses-tool' }
  const directModel = resolveImageGenerationModel(provider)
  if (directModel) return { model: directModel.id, mode: 'image-api' }
  const toolModel = resolveImageGenerationToolModel(provider)
  return toolModel ? { model: toolModel.id, mode: 'responses-tool' } : undefined
}

function latestUserMessageIndex(messages: ChatMessage[]): number {
  return messages.map((message) => message.role).lastIndexOf('user')
}

function hasEarlierGeneratedImage(messages: ChatMessage[], beforeIndex: number): boolean {
  return messages.slice(0, beforeIndex).some((message) =>
    message.role === 'assistant' && generatedImageResponsePattern.test(message.content)
  )
}

export function shouldGenerateImageForConversation(messages: ChatMessage[]): boolean {
  const latestIndex = latestUserMessageIndex(messages)
  if (latestIndex < 0) return false
  const request = messages[latestIndex].content.trim()
  if (!request) return false
  if (isImageGenerationRequest(request)) return true
  if (!hasEarlierGeneratedImage(messages, latestIndex)) return false
  if (imageQuestionOrFeedbackPattern.test(request)) return false
  return imageContinuationPattern.test(request)
}

function findContinuationAnchor(messages: ChatMessage[], latestIndex: number): number {
  for (let index = latestIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const hasImage = message.attachments?.some((attachment) => attachment.kind === 'image' && attachment.dataUrl)
    if (hasImage || isImageGenerationRequest(message.content)) return index
  }
  return latestIndex
}

function uniqueReferenceImages(messages: ChatMessage[]): PreparedAttachment[] {
  const seen = new Set<string>()
  const result: PreparedAttachment[] = []
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind !== 'image' || !attachment.dataUrl) continue
      const identity = attachment.id || attachment.dataUrl
      if (seen.has(identity)) continue
      seen.add(identity)
      result.push(attachment)
    }
  }
  return result.slice(-4)
}

export function buildImageGenerationContext(messages: ChatMessage[]): ImageGenerationContext {
  const latestIndex = latestUserMessageIndex(messages)
  if (latestIndex < 0) {
    return { prompt: '生成一张简洁、清晰、高质量的图片。', referenceImages: [], isContinuation: false }
  }

  const latest = messages[latestIndex]
  const isContinuation = continuationReferencePattern.test(latest.content) && hasEarlierGeneratedImage(messages, latestIndex)
  const anchor = isContinuation ? findContinuationAnchor(messages, latestIndex) : latestIndex
  const relevantMessages = messages.slice(anchor, latestIndex + 1).filter((message) => message.role === 'user').slice(-6)
  const requirements = relevantMessages
    .map((message, index) => `${index === relevantMessages.length - 1 ? '当前要求' : '此前要求'}：${message.content.trim()}`)
    .filter((line) => !line.endsWith('：'))

  return {
    prompt: requirements.join('\n') || '生成一张简洁、清晰、高质量的图片。',
    referenceImages: uniqueReferenceImages(relevantMessages),
    isContinuation
  }
}
