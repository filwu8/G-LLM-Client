/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage, PreparedAttachment } from '../shared/types.ts'
import {
  buildImageGenerationContext,
  buildImageGenerationRequestBody,
  resolveImageGenerationTarget,
  shouldGenerateImageForConversation
} from './imageGenerationContext.ts'

const referenceImage: PreparedAttachment = {
  id: 'logo',
  name: 'logo.png',
  mimeType: 'image/png',
  size: 128,
  kind: 'image',
  dataUrl: 'data:image/png;base64,AAAA'
}

function message(role: ChatMessage['role'], content: string, attachments?: PreparedAttachment[]): ChatMessage {
  return { id: `${role}-${content}`, role, content, attachments, createdAt: 1 }
}

test('distinguishes image requests from feedback and questions', () => {
  const history = [
    message('user', '参考这个 logo，生成一个现代版本', [referenceImage]),
    message('assistant', '已生成图片：\n\n![生成图片 1](gllm-data://generated-images/one.png)')
  ]
  assert.equal(shouldGenerateImageForConversation([...history, message('user', '你收到我之前的 logo 了吗？')]), false)
  assert.equal(shouldGenerateImageForConversation([...history, message('user', '为什么和原来的 logo 不一样？')]), false)
  assert.equal(shouldGenerateImageForConversation([...history, message('user', '再生成一张，更接近原图')]), true)
})

test('carries the original requirement and reference image into a continuation', () => {
  const context = buildImageGenerationContext([
    message('user', '参考这个 logo，生成一个现代版本', [referenceImage]),
    message('assistant', '已生成图片：\n\n![生成图片 1](gllm-data://generated-images/one.png)'),
    message('user', '辨识度不够，请保留原来的轮廓'),
    message('assistant', '明白。'),
    message('user', '再生成一张')
  ])

  assert.equal(context.isContinuation, true)
  assert.equal(context.referenceImages[0], referenceImage)
  assert.match(context.prompt, /参考这个 logo/)
  assert.match(context.prompt, /保留原来的轮廓/)
  assert.match(context.prompt, /再生成一张/)
})

test('does not leak an old reference into an unrelated image request', () => {
  const context = buildImageGenerationContext([
    message('user', '参考这个 logo，生成一个现代版本', [referenceImage]),
    message('assistant', '已生成图片：\n\n![生成图片 1](gllm-data://generated-images/one.png)'),
    message('user', '画一只戴礼帽的猫')
  ])

  assert.equal(context.isContinuation, false)
  assert.deepEqual(context.referenceImages, [])
  assert.doesNotMatch(context.prompt, /logo/)
})

test('uses a reference-capable tool when available and exposes direct-only providers', () => {
  const mixedProvider = {
    id: 'mixed', templateId: 'local-compatible' as const, name: 'Mixed', apiBaseUrl: 'http://localhost/v1',
    apiKey: '', requiresApiKey: false, defaultModel: 'flux',
    models: [
      { id: 'flux', capabilities: ['image' as const] },
      { id: 'vision-tool', capabilities: ['chat' as const, 'vision' as const, 'image-tool' as const] }
    ]
  }
  const directOnlyProvider = { ...mixedProvider, models: mixedProvider.models.slice(0, 1) }

  assert.deepEqual(resolveImageGenerationTarget(mixedProvider, true), { model: 'vision-tool', mode: 'responses-tool' })
  assert.deepEqual(resolveImageGenerationTarget(directOnlyProvider, true), { model: 'flux', mode: 'image-api' })
  assert.deepEqual(resolveImageGenerationTarget(mixedProvider, false), { model: 'flux', mode: 'image-api' })
})

test('sends reference pixels only through a supported Responses image tool', () => {
  const responsesBody = buildImageGenerationRequestBody(
    { model: 'vision-tool', mode: 'responses-tool' },
    '保留轮廓并改成蓝色',
    [referenceImage],
    '1024x1024',
    'high'
  )
  assert.equal(responsesBody.model, 'vision-tool')
  assert.match(JSON.stringify(responsesBody), /input_image/)
  assert.match(JSON.stringify(responsesBody), /data:image\/png;base64,AAAA/)

  assert.throws(() => buildImageGenerationRequestBody(
    { model: 'flux', mode: 'image-api' },
    '保留轮廓并改成蓝色',
    [referenceImage],
    '1024x1024',
    'high'
  ), /REFERENCE_IMAGE_UNSUPPORTED/)
})
