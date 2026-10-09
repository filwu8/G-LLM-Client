/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export interface SkillInstallIntent {
  urls: string[]
  referenceName: string
  targetAssistantName?: string
  inlineMarkdown?: string
}

/** Route explicit installation requests locally; questions and quoted examples remain chat. */
export function getSkillInstallIntent(message: string): SkillInstallIntent | null {
  const text = message.trim()
  const head = text.split('\n', 1)[0]
  if (/^(?:>|```|["“「])/.test(head)) return null
  if (/不要|别(?:给|帮|安装|导入|绑定)|不(?:要|需要|想)|取消|卸载|如何|怎么|怎样|是否|可行|支持吗|为什么|如果|假如|例如|比如|\b(?:do not|don't|uninstall|how|why|can i|should i|example)\b/i.test(head)) return null
  const action = /安装|导入|绑定|启用|装上|添加|\b(?:install|import|bind|enable|add)\b/i.exec(head)
  if (!action || !/(?:skills?\b|技能|\.md\b|\.markdown\b)/i.test(text)) return null
  const prefix = head.slice(0, action.index).trim()
  if (prefix && !/^(?:请|帮|麻烦|给|为|先|现在|我想|我要|我需要|可以|能|把|将|please|help|could you|can you|i want|i need)/i.test(prefix)) return null
  const inlineMarkdown = text.match(/```(?:markdown|md)\s*\n([\s\S]*?)\n```/i)?.[1]
  const withoutCode = text.replace(/```[\s\S]*?```/g, '')
  const urls = [...new Set((withoutCode.match(/https?:\/\/[^\s<>"“”「」]+/gi) ?? [])
    .map((url) => url.replace(/[)\]}>。，；！,.!;]+$/, '')))]
  const targetMatch = head.match(/(?:给|为)\s*(?:我(?:的)?\s*)?[「“"']?([^「」“”"'\s，,]{1,40}?)[」”"']?助手/)
  const target = targetMatch?.[1]
    ?? head.match(/(?:给|为)助手\s*[「“"']([^」”"']+)[」”"']/)?.[1]
    ?? head.match(/\b(?:for|to)\s+(?:the\s+)?["']?([\w -]{1,40}?)["']?\s+assistant\b/i)?.[1]
  const targetAssistantName = target && !/^(?:当前|这个|本|此|正在使用的|current|this)$/i.test(target) ? target : undefined
  let remainder = head.slice(action.index + action[0].length)
  const quoted = remainder.match(/[「“"']([^」”"']+)[」”"']/)?.[1]
  remainder = remainder.split(/[，,。；;]/, 1)[0]
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/^(?:一下|一个|这(?:个|份)|该|我(?:刚才)?上传的|附件(?:里|中|里的|中的)?|已保存的|现有的|名为|叫作|the|this|a|an)\s*/gi, '')
    .replace(/^(?:(?:the|a|an|existing|saved|uploaded|attached)\s+)+/i, '')
    .replace(/^(?:skills?|技能)\s*[:：]?\s*/i, '')
    .replace(/^(?:named|called|名为|叫作)\s*/i, '')
    .replace(/\s*(?:到|给|用于|for|to)\s*(?:当前|这个|the current|this).*$/i, '')
    .replace(/\s*(?:skills?|技能|的规则|规则)\s*(?:吧|呀|啊|好吗|可以吗)?[.。!！?？]*$/i, '')
    .trim()
  return { urls, referenceName: (quoted || remainder).slice(0, 100), targetAssistantName, inlineMarkdown }
}
