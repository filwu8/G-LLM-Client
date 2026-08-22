/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ChatMessage, WebSearchMode } from './types'

export type WebSearchDecisionReason =
  | 'forced-on'
  | 'forced-off'
  | 'empty'
  | 'acknowledgement'
  | 'user-disabled'
  | 'explicit-request'
  | 'external-reference'
  | 'fresh-information'
  | 'recommendation'
  | 'model-knowledge'

export interface WebSearchDecision {
  enabled: boolean
  reason: WebSearchDecisionReason
}

const acknowledgementPattern = /^(?:谢谢|谢了|好的|好|可以|行|明白了|知道了|收到|继续|没事|ok(?:ay)?|thanks?|got it|continue)[！!。.\s]*$/i
const userDisabledPattern = /(?:不要|无需|不用|别|禁止).{0,8}(?:联网|上网|网络搜索|网页搜索|检索)|\b(?:do not|don't|dont|without)\s+(?:browse|search(?:ing)?(?:\s+the)?\s+(?:web|internet)|go online)\b/i
const explicitSearchPattern = /(?:联网|上网|网络搜索|网页搜索|搜索互联网|检索网络|帮我查一下|查一查|搜索一下|检索一下)|\b(?:browse|search|look up|check)\s+(?:the\s+)?(?:web|internet|online)\b/i
const urlPattern = /(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|cn|net|org|io|ai|dev|app|gov|edu)(?:\b|\/)/i
const externalReferencePattern = /(?:打开|查看|访问|分析|评估|核实|看看).{0,10}(?:官网|网站|网页|链接|URL)|\b(?:open|visit|review|inspect|analy[sz]e|verify|check)\b.{0,32}\b(?:website|webpage|site|link|url)\b/i
const freshInformationPattern = /(?:最新|最近|今日|今天|本周|本月|今年|刚刚|实时|新闻|热搜|汇率|天气|政策|法规|法律|税率|利率|赛程|比分|排名|版本更新|最新版本|发布计划|官方文档|API\s*文档|(?:查|查询|现在|当前|最新|今日).{0,8}(?:价格|报价|售价)|(?:价格|报价|售价|多少钱).{0,8}(?:多少|怎么样|走势|查询|现在|当前|最新|今日)|当前.{0,6}(?:版本|政策|状态|排名|负责人|总统|主席|CEO|首席执行官))|\b(?:latest|recent|today|this\s+(?:week|month|year)|real[- ]?time|news|weather|exchange\s+rate|law|regulation|policy|tax\s+rate|interest\s+rate|score|schedule|standings|release\s+notes?|current\s+(?:version|price|pricing|policy|status|ranking|president|ceo)|(?:check|find|latest|today'?s?)\s+(?:price|pricing)|official\s+(?:docs|documentation)|api\s+docs)\b/i
const recommendationPattern = /(?:推荐|哪个好|哪一款|选购|值得买|比较|对比).{0,24}(?:产品|软件|工具|餐厅|酒店|旅行|旅游|机票|景点|手机|电脑|相机|汽车)|(?:产品|软件|工具|餐厅|酒店|旅行|旅游|机票|景点|手机|电脑|相机|汽车).{0,18}(?:推荐|选择|比较|对比|购买|预订|去哪|哪个好|哪一款)|\b(?:recommend|best|which\s+one|compare|buy|book)\b.{0,40}\b(?:product|software|tool|phone|laptop|camera|car|restaurant|hotel|flight|travel|trip|destination)\b/i

export function decideWebSearch(mode: WebSearchMode, text: string): WebSearchDecision {
  const normalized = text.trim()
  if (!normalized) return { enabled: false, reason: 'empty' }
  if (acknowledgementPattern.test(normalized)) return { enabled: false, reason: 'acknowledgement' }
  if (mode === 'off') return { enabled: false, reason: 'forced-off' }
  if (mode === 'on') return { enabled: true, reason: 'forced-on' }
  if (userDisabledPattern.test(normalized)) return { enabled: false, reason: 'user-disabled' }
  if (explicitSearchPattern.test(normalized)) return { enabled: true, reason: 'explicit-request' }
  if (urlPattern.test(normalized) || externalReferencePattern.test(normalized)) {
    return { enabled: true, reason: 'external-reference' }
  }
  if (freshInformationPattern.test(normalized)) return { enabled: true, reason: 'fresh-information' }
  if (recommendationPattern.test(normalized)) return { enabled: true, reason: 'recommendation' }
  return { enabled: false, reason: 'model-knowledge' }
}

export function decideConversationWebSearch(mode: WebSearchMode, messages: ChatMessage[]): WebSearchDecision {
  const latestUserText = messages.slice().reverse().find((message) => message.role === 'user')?.content ?? ''
  return decideWebSearch(mode, latestUserText)
}
