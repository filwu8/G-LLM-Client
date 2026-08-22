/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { WebResearchAudit, WebResearchConflict, WebSearchResult } from '../shared/types'
import {
  extractResearchKeywords,
  extractNamedSearchEntities,
  extractSearchDomains,
  normalizeSearchMatchText,
  type ResearchPlan
} from './webSearchPolicy.ts'

export type EvidenceRejectionReason = 'duplicate' | 'outdated' | 'not-applicable' | 'low-relevance'

export interface ResearchGovernanceResult {
  accepted: WebSearchResult[]
  candidateCount: number
  duplicateCount: number
  outdatedCount: number
  notApplicableCount: number
  lowRelevanceCount: number
  conflicts: WebResearchConflict[]
  coveredQuestions: string[]
  uncoveredQuestions: string[]
  supplementalQueries: string[]
}

interface RankedCandidate {
  result: WebSearchResult
  text: string
  canonicalUrl: string
  domain: string
  score: number
  sourceRole: NonNullable<WebSearchResult['sourceRole']>
}

const communityDomains = ['reddit.com', 'zhihu.com', 'stocktwits.com', 'x.com', 'twitter.com', 'facebook.com', 'linkedin.com']
const aggregatorDomains = ['baike.baidu.com', 'zhidao.baidu.com', 'wikipedia.org', 'medium.com', 'sohu.com', '163.com']
const trackingParameterPattern = /^(?:utm_|gclid|fbclid|clid|mc_|mcid|ref|source|src|spm|_openstat|yclid|ga_|s?cid|srsltid)/i

function getResultDomain(result: WebSearchResult): string {
  if (result.sourceDomain?.trim()) return result.sourceDomain.trim().toLocaleLowerCase().replace(/^www\./, '')
  try {
    return new URL(result.url).hostname.toLocaleLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function canonicalizeResearchUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    const kept = new URLSearchParams()
    for (const [key, item] of url.searchParams.entries()) {
      if (!trackingParameterPattern.test(key)) kept.append(key, item)
    }
    url.search = kept.toString()
    url.hostname = url.hostname.toLocaleLowerCase().replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
    return url.toString().replace(/\/$/, '')
  } catch {
    return value.trim().replace(/#.*$/, '').replace(/\/$/, '')
  }
}

function domainMatches(domain: string, candidate: string): boolean {
  return domain === candidate || domain.endsWith(`.${candidate}`)
}

function getRegistrableDomainLabel(domain: string): string {
  const labels = domain.split('.').filter(Boolean)
  if (labels.length < 2) return labels[0] ?? ''
  const usesCountrySecondLevel = labels.length >= 3 && labels.at(-1)?.length === 2 && /^(?:co|com|net|org|gov|edu)$/.test(labels.at(-2) ?? '')
  return labels.at(usesCountrySecondLevel ? -3 : -2) ?? ''
}

export function classifyResearchSource(result: WebSearchResult, userQuery: string): NonNullable<WebSearchResult['sourceRole']> {
  const domain = getResultDomain(result)
  if (!domain) return 'unknown'
  if (extractSearchDomains(userQuery).some((requested) => domainMatches(domain, requested))) return 'specified'
  const registrableLabel = normalizeSearchMatchText(getRegistrableDomainLabel(domain))
  const namedEntities = extractNamedSearchEntities(userQuery)
  if (
    /\.(?:gov|gov\.cn|edu|edu\.cn)$/i.test(domain) ||
    /政府|监管|法院|大学|研究所|官方公告|official|regulator/i.test(result.title) ||
    namedEntities.some((entity) => registrableLabel === normalizeSearchMatchText(entity))
  ) return 'primary'
  if (communityDomains.some((candidate) => domainMatches(domain, candidate))) return 'community'
  if (aggregatorDomains.some((candidate) => domainMatches(domain, candidate))) return 'aggregator'
  return 'independent'
}

function getCandidateText(result: WebSearchResult): string {
  return [result.title, result.source, result.sourceDomain, result.snippet, result.excerpt, result.url]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasUsableEvidenceContext(result: WebSearchResult): boolean {
  const evidence = normalizeSearchMatchText([result.snippet, result.excerpt].filter(Boolean).join(' '))
  return evidence.length >= 12
}

function getCharacterShingles(value: string, size = 3): Set<string> {
  const normalized = normalizeSearchMatchText(value).slice(0, 3_000)
  const shingles = new Set<string>()
  if (normalized.length <= size) {
    if (normalized) shingles.add(normalized)
    return shingles
  }
  for (let index = 0; index <= normalized.length - size; index += 1) shingles.add(normalized.slice(index, index + size))
  return shingles
}

function setSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const item of left) if (right.has(item)) intersection += 1
  return intersection / (left.size + right.size - intersection)
}

export function areResearchResultsDuplicates(left: WebSearchResult, right: WebSearchResult): boolean {
  if (canonicalizeResearchUrl(left.url) === canonicalizeResearchUrl(right.url)) return true
  const leftTitle = normalizeSearchMatchText(left.title)
  const rightTitle = normalizeSearchMatchText(right.title)
  const contentSimilarity = setSimilarity(getCharacterShingles(getCandidateText(left)), getCharacterShingles(getCandidateText(right)))
  if (leftTitle.length >= 12 && leftTitle === rightTitle && contentSimilarity >= 0.55) return true
  return contentSimilarity >= 0.82
}

const scopeGroups: Array<Array<{ key: string; pattern: RegExp }>> = [
  [
    { key: 'cn', pattern: /中国|中国大陆|国内|A股|\bCN\b/i },
    { key: 'us', pattern: /美国|美股|\bUSA?\b|United States/i },
    { key: 'hk', pattern: /香港|港股|\bHK\b/i },
    { key: 'eu', pattern: /欧盟|欧洲|\bEU\b|European Union/i }
  ],
  [
    { key: 'windows', pattern: /Windows/i },
    { key: 'macos', pattern: /macOS|Mac OS/i },
    { key: 'linux', pattern: /Linux/i },
    { key: 'ios', pattern: /\biOS\b|iPhone|iPad/i },
    { key: 'android', pattern: /Android/i }
  ]
]

function hasScopeConflict(query: string, resultText: string): boolean {
  for (const group of scopeGroups) {
    const requested = new Set(group.filter((item) => item.pattern.test(query)).map((item) => item.key))
    const offered = new Set(group.filter((item) => item.pattern.test(resultText)).map((item) => item.key))
    if (requested.size > 0 && offered.size > 0 && !Array.from(requested).some((item) => offered.has(item))) return true
  }

  const versionPattern = /\bv(?:ersion\s*)?(\d+(?:\.\d+){1,3})\b/gi
  const requestedVersions = new Set(Array.from(query.matchAll(versionPattern), (match) => match[1]))
  const resultVersions = new Set(Array.from(resultText.matchAll(versionPattern), (match) => match[1]))
  return requestedVersions.size > 0 && resultVersions.size > 0 && !Array.from(requestedVersions).some((item) => resultVersions.has(item))
}

function getRelevanceScore(
  result: WebSearchResult,
  plan: ResearchPlan,
  userQuery: string,
  now: number
): { score: number; matchedEntityCount: number; matchedKeywordCount: number; matchedTopicKeywordCount: number } {
  const text = normalizeSearchMatchText(getCandidateText(result))
  const requiredEntities = Array.from(new Set(plan.requiredEntities.map(normalizeSearchMatchText).filter(Boolean)))
  const aliases = Array.from(new Set(plan.aliases.map(normalizeSearchMatchText).filter(Boolean)))
  const entities = [...requiredEntities, ...aliases]
  const keywords = extractResearchKeywords([plan.userGoal, ...plan.questions, ...plan.queries, userQuery].join(' '))
    .filter((keyword) => !entities.includes(keyword))
  const topicKeywords = extractResearchKeywords(userQuery).filter((keyword) => !entities.includes(keyword))
  const matchedRequiredEntityCount = requiredEntities.filter((entity) => text.includes(entity)).length
  const matchedAliasCount = aliases.filter((entity) => text.includes(entity)).length
  const matchedKeywordCount = keywords.filter((keyword) => text.includes(keyword)).length
  const matchedTopicKeywordCount = topicKeywords.filter((keyword) => text.includes(keyword)).length
  const role = classifyResearchSource(result, userQuery)
  let score = matchedRequiredEntityCount * 12 + matchedAliasCount * 5 + Math.min(12, matchedKeywordCount * 2)
  if (role === 'specified' || role === 'primary') score += 4
  else if (role === 'independent') score += 2
  else if (role === 'aggregator') score -= 2
  if (plan.freshnessDays) {
    if (result.publishedAt) {
      const ageDays = Math.max(0, (now - result.publishedAt) / 86_400_000)
      score += Math.max(0, 6 - ageDays / Math.max(1, plan.freshnessDays / 6))
    } else {
      score -= 2
    }
  } else if (result.publishedAt) {
    score += 1
  }
  return { score, matchedEntityCount: matchedRequiredEntityCount, matchedKeywordCount, matchedTopicKeywordCount }
}

function isOutdated(result: WebSearchResult, plan: ResearchPlan, now: number): boolean {
  if (!plan.freshnessDays || !result.publishedAt) return false
  const ageDays = (now - result.publishedAt) / 86_400_000
  return ageDays > plan.freshnessDays || ageDays < -2
}

function extractRelevantSentences(result: WebSearchResult, keywords: string[]): string[] {
  const source = [result.snippet, result.excerpt].filter(Boolean).join(' ')
  return source
    .split(/(?<=[。！？.!?])\s*/u)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 16 && sentence.length <= 320)
    .filter((sentence) => {
      const normalized = normalizeSearchMatchText(sentence)
      return keywords.length === 0 || keywords.some((keyword) => normalized.includes(keyword))
    })
    .slice(0, 12)
}

function hasNegativePolarity(value: string): boolean {
  return /不支持|不提供|不能|无法|没有|尚未|并非|否认|错误|虚假|not\s|no\s|without|cannot|doesn't|isn't/i.test(value)
}

function normalizeClaim(value: string): string {
  return normalizeSearchMatchText(value)
    .replace(/\d+(?:\.\d+)?%?/g, '')
    .replace(/不支持|不提供|不能|无法|没有|尚未|并非|否认|错误|虚假|not|no|without|cannot|doesnt|isnt/g, '')
}

function findEvidenceConflicts(results: WebSearchResult[], plan: ResearchPlan): WebResearchConflict[] {
  const keywords = extractResearchKeywords([plan.userGoal, ...plan.questions].join(' '))
  const statements = results.flatMap((result) => extractRelevantSentences(result, keywords).map((sentence) => ({
    sentence,
    result,
    normalized: normalizeClaim(sentence),
    negative: hasNegativePolarity(sentence),
    numbers: Array.from(sentence.matchAll(/\d+(?:\.\d+)?%?/g), (match) => match[0])
  })))
  const conflicts: WebResearchConflict[] = []

  for (let leftIndex = 0; leftIndex < statements.length; leftIndex += 1) {
    const left = statements[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < statements.length; rightIndex += 1) {
      const right = statements[rightIndex]
      if (getResultDomain(left.result) === getResultDomain(right.result)) continue
      const similarity = setSimilarity(getCharacterShingles(left.normalized), getCharacterShingles(right.normalized))
      const polarityConflict = left.negative !== right.negative
      const numberConflict = left.numbers.length > 0 && right.numbers.length > 0 && left.numbers.join('|') !== right.numbers.join('|')
      if (similarity < (polarityConflict ? 0.56 : 0.68) || (!polarityConflict && !numberConflict)) continue
      const urls = [left.result.url, right.result.url]
      if (conflicts.some((conflict) => conflict.sourceUrls.some((url) => urls.includes(url)))) continue
      conflicts.push({
        topic: left.sentence.slice(0, 90),
        summary: polarityConflict
          ? '不同独立来源对同一主张给出了肯定与否定两种表述，需要结合时间、版本和适用条件继续核验。'
          : '不同独立来源对同一指标给出了不一致的数值，需要核对统计口径、时间范围和原始数据。',
        sourceUrls: urls
      })
      if (conflicts.length >= 5) return conflicts
    }
  }
  return conflicts
}

function isQuestionCovered(question: string, accepted: WebSearchResult[]): boolean {
  if (accepted.length === 0) return false
  if (/独立|反馈|社区|用户体验/.test(question)) {
    return accepted.some((result) => result.sourceRole === 'independent' || result.sourceRole === 'community')
  }
  if (/原始|官方|主体/.test(question)) {
    return accepted.some((result) => result.sourceRole === 'primary' || result.sourceRole === 'specified')
  }
  const keywords = extractResearchKeywords(question)
  if (keywords.length === 0) return true
  return accepted.some((result) => {
    const normalized = normalizeSearchMatchText(getCandidateText(result))
    const matched = keywords.filter((keyword) => normalized.includes(keyword)).length
    return matched >= Math.min(2, keywords.length)
  })
}

function buildSupplementalQueries(plan: ResearchPlan, uncoveredQuestions: string[]): string[] {
  const entity = plan.requiredEntities.join(' ') || plan.queries[0] || plan.userGoal
  return uncoveredQuestions
    .map((question) => [entity, question].filter(Boolean).join(' ').trim())
    .filter(Boolean)
    .filter((query, index, all) => all.indexOf(query) === index)
    .slice(0, Math.min(2, plan.budget.maxQueries))
}

export function governWebResearch(
  results: WebSearchResult[],
  plan: ResearchPlan,
  userQuery: string,
  now = Date.now()
): ResearchGovernanceResult {
  const counters: Record<EvidenceRejectionReason, number> = {
    duplicate: 0,
    outdated: 0,
    'not-applicable': 0,
    'low-relevance': 0
  }
  const ranked: RankedCandidate[] = []

  for (const result of results.slice(0, plan.budget.maxCandidates)) {
    const text = getCandidateText(result)
    const relevance = getRelevanceScore(result, plan, userQuery, now)
    if (plan.requiredEntities.length > 0 && relevance.matchedEntityCount === 0) {
      counters['low-relevance'] += 1
      continue
    }
    if (plan.requiredEntities.length === 0 && relevance.matchedTopicKeywordCount === 0) {
      counters['low-relevance'] += 1
      continue
    }
    if (hasScopeConflict([userQuery, plan.userGoal].join(' '), text)) {
      counters['not-applicable'] += 1
      continue
    }
    if (isOutdated(result, plan, now)) {
      counters.outdated += 1
      continue
    }
    if (!hasUsableEvidenceContext(result)) {
      counters['low-relevance'] += 1
      continue
    }
    ranked.push({
      result,
      text,
      canonicalUrl: canonicalizeResearchUrl(result.url),
      domain: getResultDomain(result),
      score: relevance.score,
      sourceRole: classifyResearchSource(result, userQuery)
    })
  }

  ranked.sort((left, right) => right.score - left.score)
  const accepted: WebSearchResult[] = []
  const domainCounts = new Map<string, number>()
  const selectedCandidates = new Set<RankedCandidate>()

  const acceptCandidate = (candidate: RankedCandidate, countRejection: boolean): boolean => {
    if (selectedCandidates.has(candidate)) return false
    if (accepted.some((existing) => areResearchResultsDuplicates(existing, candidate.result))) {
      if (countRejection) counters.duplicate += 1
      return false
    }
    const domainCount = candidate.domain ? (domainCounts.get(candidate.domain) ?? 0) : 0
    if (candidate.domain && domainCount >= plan.budget.maxSourcesPerDomain) {
      if (countRejection) counters.duplicate += 1
      return false
    }
    const clusterId = `evidence_${accepted.length + 1}`
    accepted.push({
      ...candidate.result,
      sourceDomain: candidate.domain || candidate.result.sourceDomain,
      sourceRole: candidate.sourceRole,
      relevanceScore: candidate.score,
      clusterId
    })
    if (candidate.domain) domainCounts.set(candidate.domain, domainCount + 1)
    selectedCandidates.add(candidate)
    return true
  }

  const desiredRoles = plan.sourceRoles.filter((role): role is NonNullable<WebSearchResult['sourceRole']> =>
    ['specified', 'primary', 'independent', 'community', 'aggregator', 'unknown'].includes(role)
  )
  for (const desiredRole of desiredRoles) {
    for (const candidate of ranked) {
      const roleMatches = desiredRole === 'primary'
        ? candidate.sourceRole === 'primary' || candidate.sourceRole === 'specified'
        : candidate.sourceRole === desiredRole
      if (roleMatches && acceptCandidate(candidate, false)) break
    }
    if (accepted.length >= plan.budget.maxAcceptedSources) break
  }

  for (const candidate of ranked) {
    if (accepted.length >= plan.budget.maxAcceptedSources) break
    acceptCandidate(candidate, true)
  }

  const coveredQuestions = plan.questions.filter((question) => isQuestionCovered(question, accepted))
  const uncoveredQuestions = plan.questions.filter((question) => !coveredQuestions.includes(question))
  return {
    accepted,
    candidateCount: results.length,
    duplicateCount: counters.duplicate,
    outdatedCount: counters.outdated,
    notApplicableCount: counters['not-applicable'],
    lowRelevanceCount: counters['low-relevance'],
    conflicts: findEvidenceConflicts(accepted, plan),
    coveredQuestions,
    uncoveredQuestions,
    supplementalQueries: buildSupplementalQueries(plan, uncoveredQuestions)
  }
}

export function selectEvidencePassage(result: WebSearchResult, plan: ResearchPlan, maxCharacters: number): string {
  const keywords = extractResearchKeywords([plan.userGoal, ...plan.questions].join(' '))
  const sentences = extractRelevantSentences(result, keywords)
  const fallback = [result.snippet, result.excerpt].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const selected = (sentences.length > 0 ? sentences.join(' ') : fallback).slice(0, maxCharacters)
  return selected
}

/**
 * Preserve a useful, fully attributable response when an upstream model twice
 * returns an empty body or an internal classification label.
 */
export function buildResearchRecoveryAnswer(
  results: WebSearchResult[],
  plan: ResearchPlan,
  audit: WebResearchAudit
): string {
  if (results.length === 0) {
    return [
      '本次模型没有生成有效正文，客户端也没有检索到足够相关的公开证据。',
      '',
      `已检查 ${audit.candidateCount} 个候选结果，但没有可安全采用的来源。建议补充更明确的名称、网址或限定条件后重试；复杂联网任务可改用更稳定的模型。`
    ].join('\n')
  }

  const evidence = results.slice(0, 4).map((result, index) => {
    const title = result.title.replace(/\s+/g, ' ').trim().slice(0, 100) || `来源 ${index + 1}`
    const passage = selectEvidencePassage(result, plan, 220).replace(/\s+/g, ' ').trim()
    return `- [${title}](${result.url})${passage ? `：${passage}` : ''}`
  })
  return [
    '模型连续两次没有生成有效正文。客户端已保留本次检索到的证据，避免整次请求无结果：',
    '',
    ...evidence,
    '',
    `当前证据覆盖 ${audit.coveredQuestionCount}/${audit.totalQuestionCount} 个研究问题、采用 ${audit.acceptedCount}/${audit.candidateCount} 个候选来源。以上是检索证据摘要，不等同于模型完成的综合结论；需要完整分析时可直接重发或切换更稳定的模型。`
  ].join('\n')
}

const abnormalResearchLabels = [
  'user safety: safe',
  'user safety: unsafe',
  'user safety: unknown',
  'user safety: allowed',
  'user safety: blocked',
  'safety: safe',
  'safety: unsafe',
  'safety: unknown',
  'safety: allowed',
  'safety: blocked'
]

function normalizePotentialResearchAnswer(value: string): string {
  return value.replace(/[`*_#]/g, '').trim().toLocaleLowerCase().replace(/[.。]$/, '')
}

export function isAbnormalWebResearchAnswer(value: string): boolean {
  const content = normalizePotentialResearchAnswer(value)
  if (!content) return true
  return abnormalResearchLabels.includes(content.replace('：', ':'))
}

export function isPotentialAbnormalWebResearchAnswer(value: string): boolean {
  const content = normalizePotentialResearchAnswer(value).replace('：', ':')
  return !content || abnormalResearchLabels.some((label) => label.startsWith(content))
}
