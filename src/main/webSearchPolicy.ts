/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { WebResearchDepth, WebResearchTaskType } from '../shared/types'

export interface SearchPlanInput {
  intent?: unknown
  taskType?: unknown
  userGoal?: unknown
  requiredEntities?: unknown
  aliases?: unknown
  questions?: unknown
  sourceRoles?: unknown
  freshnessDays?: unknown
  queries?: unknown
}

export type ResearchTaskType = WebResearchTaskType

export interface ResearchBudget {
  maxQueries: number
  maxCandidates: number
  maxAcceptedSources: number
  maxSourcesPerDomain: number
  maxExcerptSources: number
  maxExcerptCharacters: number
  maxContextCharacters: number
  maxRounds: number
  minimumAcceptedSources: number
}

export interface ResearchPlan {
  intent: string
  taskType: WebResearchTaskType
  depth: WebResearchDepth
  userGoal: string
  requiredEntities: string[]
  aliases: string[]
  questions: string[]
  sourceRoles: string[]
  freshnessDays?: number
  queries: string[]
  budget: ResearchBudget
  plannerMode: 'model' | 'fallback'
  plannerError?: string
}

const commonSecondLevelSuffixes = new Set([
  'co.jp',
  'co.kr',
  'co.uk',
  'com.au',
  'com.cn',
  'com.hk',
  'com.sg',
  'net.cn',
  'org.cn',
  'org.uk'
])
const genericDomainBrands = new Set(['api', 'app', 'blog', 'cloud', 'docs', 'mail', 'news', 'online', 'shop', 'store', 'web'])
const genericNamedEntities = new Set([
  'api', 'app', 'ai', 'http', 'https', 'ios', 'json', 'linux', 'macos', 'pdf', 'url', 'web', 'windows'
])

const researchBudgets: Record<WebResearchDepth, ResearchBudget> = {
  quick: {
    maxQueries: 2,
    maxCandidates: 10,
    maxAcceptedSources: 4,
    maxSourcesPerDomain: 2,
    maxExcerptSources: 3,
    maxExcerptCharacters: 700,
    maxContextCharacters: 4_500,
    maxRounds: 2,
    minimumAcceptedSources: 2
  },
  balanced: {
    maxQueries: 4,
    maxCandidates: 18,
    maxAcceptedSources: 7,
    maxSourcesPerDomain: 2,
    maxExcerptSources: 5,
    maxExcerptCharacters: 900,
    maxContextCharacters: 8_000,
    maxRounds: 2,
    minimumAcceptedSources: 4
  },
  deep: {
    maxQueries: 6,
    maxCandidates: 32,
    maxAcceptedSources: 10,
    maxSourcesPerDomain: 3,
    maxExcerptSources: 8,
    maxExcerptCharacters: 1_100,
    maxContextCharacters: 12_000,
    maxRounds: 2,
    minimumAcceptedSources: 6
  }
}

export function sanitizePublicSearchQuery(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, ' ')
    .replace(/\b1[3-9]\d{9}\b/g, ' ')
    .replace(/\b\d{15,19}\b/g, ' ')
    .replace(/["“”'‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

export function normalizeSearchMatchText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '')
}

export function extractSearchDomains(value: string): string[] {
  const domains = Array.from(
    value.matchAll(/\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,})\b/giu)
  ).map((match) => match[1].toLocaleLowerCase())

  return Array.from(new Set(domains))
}

function getDomainBrand(domain: string): string {
  const labels = domain.split('.').filter(Boolean)
  if (labels.length < 2) return labels[0] ?? ''
  const suffix = labels.slice(-2).join('.')
  const brandIndex = commonSecondLevelSuffixes.has(suffix) ? labels.length - 3 : labels.length - 2
  return labels[Math.max(0, brandIndex)] ?? ''
}

export function extractNamedSearchEntities(value: string): string[] {
  const candidates = [
    ...Array.from(value.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)+/g), (match) => match[0]),
    ...Array.from(value.matchAll(/\b[A-Z][A-Za-z0-9]{2,12}\b/g), (match) => match[0]),
    ...Array.from(value.matchAll(/[“"'‘]([^”"'’]{2,40})[”"'’]/gu), (match) => match[1])
  ]
  const domains = new Set(extractSearchDomains(value).map(normalizeSearchMatchText))
  const seen = new Set<string>()

  return candidates.filter((candidate) => {
    const normalized = normalizeSearchMatchText(candidate)
    if (
      normalized.length < 3 ||
      genericNamedEntities.has(normalized) ||
      Array.from(domains).some((domain) => normalized === domain || normalized.endsWith(domain)) ||
      Array.from(seen).some((existing) => existing.includes(normalized) || normalized.includes(existing)) ||
      seen.has(normalized)
    ) return false
    seen.add(normalized)
    return true
  }).slice(0, 8)
}

export function extractRequiredSearchEntities(value: string): string[] {
  return Array.from(new Set([...extractSearchDomains(value), ...extractNamedSearchEntities(value)]))
}

export function getSearchAnchors(value: string): string[] {
  const anchors = extractSearchDomains(value).flatMap((domain) => {
    const brand = getDomainBrand(domain)
    return [domain, brand.length >= 3 && !genericDomainBrands.has(brand) ? brand : '']
  })

  anchors.push(...extractNamedSearchEntities(value))

  return Array.from(new Set(anchors.map(normalizeSearchMatchText).filter((anchor) => anchor.length >= 3)))
}

export function matchesSearchAnchors(value: string, anchors: string[]): boolean {
  if (anchors.length === 0) return true
  const normalized = normalizeSearchMatchText(value)
  return anchors.some((anchor) => normalized.includes(anchor))
}

export function extractResearchKeywords(value: string): string[] {
  const cleaned = extractResearchFocus(value)
    .replace(/帮我|帮忙|请问|麻烦|看看|查查|查询|搜索|检索|了解|知道|介绍|分析|梳理|说说|聊聊|谈谈|告诉我|怎么看|怎么样|如何|为什么|哪些|什么|是否|一下|相关|信息|情况|最近|近期|最新|今天|今日|当前|现在|进展|看到/gu, ' ')
    .replace(/[的了和与及在是有吗呢吧]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const keywords = Array.from(cleaned.matchAll(/[\p{Script=Han}]{2,12}|[a-zA-Z][a-zA-Z0-9._-]{1,31}|\d{3,8}/gu))
    .map((match) => normalizeSearchMatchText(match[0]))
    .filter((keyword) => keyword.length >= 2)

  return Array.from(new Set(keywords)).slice(0, 16)
}

export function detectResearchTaskType(value: string): ResearchTaskType {
  if (/对比|比较|区别|差异|哪个好|怎么选|\bvs\.?\b|versus|compare/i.test(value)) return 'compare'
  if (/真假|是否属实|求证|核实|验证|事实核查|辟谣|靠谱吗|可信(?:吗|度)?|verify|fact[ -]?check/i.test(value)) return 'verify'
  if (/是否值得|值不值得|怎么样|好不好|优缺点|评价|评测|推荐(?:吗)?|适合(?:吗|谁)?|体验|review|worth|recommend/i.test(value)) return 'evaluate'
  if (/最新|近期|今天|今日|本周|本月|现在|当前|进展|动态|新闻|消息|行情|recent|latest|today|current/i.test(value)) return 'current'
  if (/为什么|如何|怎么|原理|原因|梳理|分析|有哪些|是什么|介绍|explore|explain|how|why/i.test(value)) return 'explore'
  return 'lookup'
}

export function getAutomaticResearchDepth(taskType: WebResearchTaskType): WebResearchDepth {
  if (taskType === 'compare' || taskType === 'evaluate' || taskType === 'verify') return 'deep'
  if (taskType === 'current' || taskType === 'explore') return 'balanced'
  return 'quick'
}

/**
 * Most direct lookups and explicit website requests can be planned more
 * reliably by the deterministic planner. Reserving an extra model call for
 * genuinely nuanced requests avoids spending time and tokens asking an
 * unstable/free model to restate information the client can derive locally.
 */
export function shouldUseModelSearchPlanner(value: string): boolean {
  const query = sanitizePublicSearchQuery(value)
  if (!query || extractSearchDomains(query).length > 0) return false

  const taskType = detectResearchTaskType(query)
  const hasComplexStructure =
    query.length > 140 ||
    /分别|同时|综合|结合|多角度|从.{0,16}(?:方面|角度)|前者|后者|利弊|权衡|条件|反例|争议/iu.test(query)

  if (hasComplexStructure) return true
  return taskType === 'compare' || taskType === 'verify'
}

export function getResearchBudget(depth: WebResearchDepth): ResearchBudget {
  return { ...researchBudgets[depth] }
}

function getDefaultResearchQuestions(taskType: WebResearchTaskType, subject: string): string[] {
  if (taskType === 'current') return [`${subject}的当前状态与最新进展`, '关键事件的发生时间与原始来源']
  if (taskType === 'compare') return ['各对象的核心事实', '共同点、差异与一致比较维度', '适用场景、取舍与限制条件']
  if (taskType === 'evaluate') return [`${subject}是什么及主要用途`, '收益、优势与适用对象', '成本、局限与风险', '独立反馈与尚未验证的信息']
  if (taskType === 'verify') return ['待核验的具体说法', '最接近事实的原始证据', '反证、限定条件与证据缺口']
  if (taskType === 'explore') return [`${subject}的核心概念与背景`, '主要观点、依据与因果关系', '争议、不同视角与不确定性']
  return [subject || '用户当前问题']
}

export function extractResearchFocus(value: string): string {
  const withoutDomains = sanitizePublicSearchQuery(value)
    .replace(/\bhttps?:\/\/[^\s，。！？、,!?;；]+/giu, ' ')
    .replace(
      /\b(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,}\b/giu,
      ' '
    )

  return withoutDomains
    .replace(/^(?:请|麻烦|能否|可以)?\s*(?:你)?\s*(?:帮我|帮忙)?\s*(?:看看|查查|查一下|搜一下|搜索一下|检索一下|了解一下|分析一下|评估一下|对比一下|聊聊|说说|谈谈|告诉我|你怎么看|你知道|知道)?\s*/u, '')
    .replace(/(?:这个|该)(?:网站|网页|软件|产品|话题|事情)/gu, ' ')
    .replace(/(?:是什么|是做什么的|怎么样|好不好|是否值得(?:使用|购买|选择)?|值不值得(?:使用|购买|选择)?|靠谱吗|是否属实)/gu, ' ')
    .replace(/[，。！？、,.!?;；:：()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function getTaskQueryVariants(subject: string, taskType: ResearchTaskType): string[] {
  if (!subject) return []
  if (taskType === 'compare') return [subject, `${subject} 对比 差异`, `${subject} 适用场景`]
  if (taskType === 'evaluate') return [subject, `${subject} 评价 用户反馈`, `${subject} 风险 争议 局限`]
  if (taskType === 'verify') return [subject, `${subject} 原始来源`, `${subject} 事实核查 证据`]
  if (taskType === 'current') return [subject, `${subject} 最新进展`, `${subject} 官方消息`]
  if (taskType === 'explore') return [subject, `${subject} 背景 原理`, `${subject} 不同观点`]
  return [subject]
}

function getDomainResearchQueries(value: string, taskType: ResearchTaskType): string[] {
  const domains = extractSearchDomains(value)
  if (domains.length === 0) return []
  const focus = extractResearchFocus(value)

  if (domains.length > 1) {
    return [
      `${domains.join(' ')} ${focus || '对比'}`,
      ...domains.map((domain) => `site:${domain} ${focus}`)
    ]
  }

  const domain = domains[0]
  const brand = getDomainBrand(domain) || domain
  const subject = [domain, focus].filter(Boolean).join(' ')
  const officialQuery = `site:${domain} ${focus}`.trim()
  const variants = getTaskQueryVariants(subject, taskType)
  const independentVariant = taskType === 'evaluate'
    ? `${brand} ${focus} 评价 用户反馈 风险`
    : taskType === 'verify'
      ? `${brand} ${focus} 第三方 证据`
      : variants[1]

  return [officialQuery, variants[0], independentVariant, ...variants.slice(2)].filter(Boolean)
}

export function getLocalResearchQueries(value: string): string[] {
  const taskType = detectResearchTaskType(value)
  const domainQueries = getDomainResearchQueries(value, taskType)
  if (domainQueries.length > 0) return domainQueries
  const entities = extractRequiredSearchEntities(value)
  const entityAnchors = new Set(entities.map(normalizeSearchMatchText))
  const supportingKeywords = extractResearchKeywords(value)
    .filter((keyword) => !entityAnchors.has(keyword))
    .slice(0, 4)
  const subject = [...entities, ...supportingKeywords].join(' ').trim() || extractResearchFocus(value)
  return getTaskQueryVariants(subject, taskType)
}

export function buildResilientSearchPlan(
  plan: SearchPlanInput | null,
  fallbackQuery: string,
  planner: { mode: 'model' | 'fallback'; error?: string } = { mode: plan ? 'model' : 'fallback' }
): ResearchPlan {
  const fallback = sanitizePublicSearchQuery(fallbackQuery)
  const domains = extractSearchDomains(fallback)
  const taskTypes: WebResearchTaskType[] = ['lookup', 'current', 'compare', 'evaluate', 'verify', 'explore']
  const requestedTaskType = String(plan?.taskType ?? '').trim() as WebResearchTaskType
  const taskType = taskTypes.includes(requestedTaskType) ? requestedTaskType : detectResearchTaskType(fallback)
  const depth = getAutomaticResearchDepth(taskType)
  const budget = getResearchBudget(depth)
  const list = (value: unknown, limit: number, maxCharacters = 120): string[] => Array.isArray(value)
    ? Array.from(new Set(value.map(String).map((item) => item.replace(/\s+/g, ' ').trim().slice(0, maxCharacters)).filter(Boolean))).slice(0, limit)
    : []
  const deterministicEntities = extractRequiredSearchEntities(fallback)
  const requiredEntities = Array.from(new Set([...deterministicEntities, ...list(plan?.requiredEntities, 8)])).slice(0, 8)
  const aliases = list(plan?.aliases, 12)
  const anchors = Array.from(new Set([
    ...getSearchAnchors(fallback),
    ...requiredEntities.map(normalizeSearchMatchText),
    ...aliases.map(normalizeSearchMatchText)
  ].filter((item) => item.length >= 3)))
  const localQueries = getLocalResearchQueries(fallback)
  const plannedQueries = Array.isArray(plan?.queries)
    ? plan.queries.map((query) => sanitizePublicSearchQuery(String(query))).filter(Boolean)
    : []
  const anchoredPlannedQueries = anchors.length > 0
    ? plannedQueries.filter((query) => matchesSearchAnchors(query, anchors))
    : plannedQueries

  const candidates = domains.length > 0
    ? [localQueries[0], ...anchoredPlannedQueries, ...localQueries.slice(1)]
    : localQueries.length > 0
      ? [...anchoredPlannedQueries, ...localQueries]
      : [...anchoredPlannedQueries, fallback]
  const seen = new Set<string>()
  const queries = candidates
    .map((query) => sanitizePublicSearchQuery(query ?? ''))
    .filter((query) => {
      if (!query) return false
      const key = query.toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, budget.maxQueries)
  const focus = extractResearchFocus(fallback)
  const keywordSubject = extractResearchKeywords(fallback).slice(0, 6).join(' ')
  const subject = requiredEntities.join('、') || domains.join('、') || keywordSubject || focus || fallback || '用户当前问题'
  const fallbackIntent = `研究${[subject, focus && focus !== subject ? focus : ''].filter(Boolean).join('：')}`
  const intent = String(plan?.intent ?? fallbackIntent).replace(/\s+/g, ' ').trim().slice(0, 160) || fallbackIntent
  const userGoal = String(plan?.userGoal ?? intent).replace(/\s+/g, ' ').trim().slice(0, 240) || intent
  const questions = list(plan?.questions, 6, 180)
  const sourceRoles = list(plan?.sourceRoles, 6)
  const requestedFreshnessDays = Number(plan?.freshnessDays)
  const freshnessDays = Number.isFinite(requestedFreshnessDays)
    ? Math.min(3_650, Math.max(1, Math.round(requestedFreshnessDays)))
    : taskType === 'current'
      ? 120
      : undefined

  return {
    intent,
    taskType,
    depth,
    userGoal,
    requiredEntities,
    aliases,
    questions: questions.length > 0 ? questions : getDefaultResearchQuestions(taskType, subject),
    sourceRoles: sourceRoles.length > 0
      ? sourceRoles
      : taskType === 'evaluate' || taskType === 'verify' || taskType === 'compare'
        ? ['primary', 'independent', 'community']
        : ['primary', 'independent'],
    freshnessDays,
    queries: queries.length > 0 ? queries : ['最新信息'],
    budget,
    plannerMode: planner.mode,
    plannerError: planner.error
  }
}
