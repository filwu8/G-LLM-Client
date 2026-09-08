/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ChatMessage } from '../shared/types.ts'
import { isImageGenerationRequest } from './workspaceRequestPolicy.ts'

type ImageMessage = Pick<ChatMessage, 'role' | 'content'>

// A follow-up may omit the word “image”, but must still ask for an action.
const followUpPattern = /(?:同样|相同|刚才|之前|这个|这张|上[一张幅]).{0,30}(?:场景|风格|画面|图片|图像)|(?:按照|按|照着).{0,30}(?:方向|方案|提示词|描述).{0,15}(?:生成|画|制作)|(?:改成|换成|改为|换个|调整|加上|去掉|移除|变成|再来|再画|再生成|重新生成)|\b(?:make|change|turn|add|remove|replace|regenerate|redraw)\b|\b(?:same scene|another (?:one|image|version)|generate (?:it|that))\b/i
const textOnlyPattern = /(?:不要|不用|别|先不|停止).{0,8}(?:生成|画|绘制|制作)|(?:只|仅).{0,8}(?:提示词|文字|解释|分析)|(?:解释|分析|评价|为什么|如何|怎么).{0,30}(?:图片|图像|风格|生成|画)|\b(?:do not|don't|stop)\s+(?:generate|draw|paint)|\b(?:explain|analyze|describe|why|how)\b|\b(?:prompt|text) only\b/i
const otherArtifactPattern = /(?:生成|创建|编写|写|制作|修改|改成).{0,12}(?:报告|邮件|代码|程序|文章|文档|表格)|\b(?:write|create|generate|modify|make)\b.{0,30}\b(?:report|email|code|document|spreadsheet)\b/i

/** Find the current image task, ending it when the user changes topic. */
export function getImageGenerationConversationStart(messages: readonly ImageMessage[]): number {
  let start = -1
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const text = message.content.trim()
    if (textOnlyPattern.test(text) || otherArtifactPattern.test(text)) {
      start = -1
    } else if (isImageGenerationRequest(text)) {
      if (start < 0 || !followUpPattern.test(text)) start = index
    } else if (start < 0 || !followUpPattern.test(text)) {
      start = -1
    }
  }
  return start
}

export function isImageGenerationConversation(messages: readonly ImageMessage[]): boolean {
  return getImageGenerationConversationStart(messages) >= 0
}

/** Preserve scene and proposed style, without sending local image URLs as text. */
export function buildImageGenerationConversationPrompt(messages: readonly ImageMessage[]): string {
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user')
  if (lastUserIndex < 0) return '生成一张简洁、清晰、高质量的图片。'
  const relevantMessages = messages.slice(0, lastUserIndex + 1)
  const start = getImageGenerationConversationStart(relevantMessages)
  if (start < 0 || start === lastUserIndex) return messages[lastUserIndex].content.trim()

  const context = relevantMessages.slice(start).filter((message) => message.role !== 'system').map((message) => {
    const content = message.content.replace(/!\[[^\]]*\]\([^\n]+\)/g, '[已生成图片]')
    return `${message.role === 'user' ? '用户' : '助手'}：${content}`
  }).join('\n\n')
  return `请实际生成图片。以下是本次图片任务的对话上下文，请结合之前的场景、主体和风格，以用户最新要求为准。历史助手内容仅供理解用户认可的方案。\n\n${context}`
}
