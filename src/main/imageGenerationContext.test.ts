/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildImageGenerationConversationPrompt, isImageGenerationConversation } from './imageGenerationContext.ts'

const user = (content: string) => ({ role: 'user' as const, content })
const assistant = (content: string) => ({ role: 'assistant' as const, content })
const initial = [
  user('帮我画一个7岁宝宝的幼儿画，是在游泳池游泳的照片'),
  assistant('已生成图片：\n![生成图片 1](gllm-data://generated-images/example.png)')
]
const style = user('同样的场景，给我来个宫崎骏动画片风格。')
const proposal = assistant('可以改成温暖细腻的日式手绘动画风格，水彩质感，蓝绿色池水。')
const confirmation = user('可以，按照这个方向生成')

test('routes each turn of the reported four-turn image conversation to generation', () => {
  const conversation = [initial[0]]
  assert.equal(isImageGenerationConversation(conversation), true)
  const turns = [...initial, style]
  assert.equal(isImageGenerationConversation(turns), true)
  turns.push(proposal, confirmation)
  assert.equal(isImageGenerationConversation(turns), true)
  turns.push(assistant('生成提示词：7岁宝宝在游泳池中游泳'), user('帮我画一幅画：7岁宝宝在游泳池中游泳'))
  assert.equal(isImageGenerationConversation(turns), true)
})

test('sends the original scene, requested style, assistant proposal and final instruction', () => {
  const prompt = buildImageGenerationConversationPrompt([...initial, style, proposal, confirmation])
  for (const text of ['7岁宝宝', '游泳池', '宫崎骏', '水彩质感', '按照这个方向生成']) assert.ok(prompt.includes(text))
  assert.ok(!prompt.includes('gllm-data://'))
})

test('does not generate on unrelated follow-ups, cancellation, analysis or text-only requests', () => {
  for (const text of ['你好', '谢谢', '为什么这张图片是蓝色的？', '分析这张图片', '不要生成图片', '先不画，解释一下', '只写生成图片的提示词', '改成一份报告', 'Explain the image', 'Do not generate another image', 'Write an email']) {
    assert.equal(isImageGenerationConversation([...initial, user(text)]), false, text)
  }
  assert.equal(isImageGenerationConversation([user('按照这个方向生成')]), false)
  assert.equal(isImageGenerationConversation([...initial, user('帮我写一份报告'), assistant('报告内容'), confirmation]), false)
})

test('recognizes contextual image revisions in Chinese and English', () => {
  for (const text of ['再来一张', '把背景改成夜晚', '去掉背景里的树', 'Make it watercolor', 'Generate it', 'Another version']) {
    assert.equal(isImageGenerationConversation([...initial, user(text)]), true, text)
  }
})

test('new image task after a topic change excludes the old conversation', () => {
  const messages = [...initial, user('帮我写一封邮件'), assistant('邮件正文'), user('画一只猫')]
  assert.equal(buildImageGenerationConversationPrompt(messages), '画一只猫')
  assert.equal(buildImageGenerationConversationPrompt([]), '生成一张简洁、清晰、高质量的图片。')
})

test('a new standalone image request does not inherit the previous subject', () => {
  assert.equal(buildImageGenerationConversationPrompt([...initial, user('画一只猫')]), '画一只猫')
})
