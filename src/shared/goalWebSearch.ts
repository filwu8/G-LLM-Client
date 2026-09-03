/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { GoalWebSearchScope, WebSearchResult } from './types'

const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function normalizeGoalWebSearchDomains(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/)
  return Array.from(new Set(entries.map((entry) => {
    const raw = String(entry ?? '').trim().toLocaleLowerCase()
    if (!raw) return ''
    try {
      const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
      return url.hostname.replace(/^www\./, '').replace(/\.$/, '')
    } catch {
      return ''
    }
  }).filter((domain) => domainPattern.test(domain)))).slice(0, 12)
}

export function buildWorkspaceSearchQuery(
  query: string,
  scope: GoalWebSearchScope = 'all',
  domains: string[] = []
): string {
  const normalizedQuery = query.trim().slice(0, 500)
  const normalizedDomains = normalizeGoalWebSearchDomains(domains)
  if (scope === 'specified' && normalizedDomains.length > 0) {
    return `${normalizedQuery} (${normalizedDomains.map((domain) => `site:${domain}`).join(' OR ')})`.slice(0, 700)
  }
  if (scope === 'official') return `${normalizedQuery} 官方网站 official site`.slice(0, 700)
  return normalizedQuery
}

export function getGoalSearchResultDomain(result: WebSearchResult): string {
  try {
    return new URL(result.url).hostname.toLocaleLowerCase().replace(/^www\./, '')
  } catch {
    return result.sourceDomain?.toLocaleLowerCase().replace(/^www\./, '') ?? ''
  }
}

function matchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

export function applyWorkspaceSearchScope(
  results: WebSearchResult[],
  scope: GoalWebSearchScope = 'all',
  domains: string[] = [],
  corroboratedDomains: ReadonlySet<string> = new Set()
): WebSearchResult[] {
  const normalizedDomains = normalizeGoalWebSearchDomains(domains)
  if (scope === 'specified') {
    return results
      .filter((result) => normalizedDomains.some((domain) => matchesDomain(getGoalSearchResultDomain(result), domain)))
      .map((result) => ({ ...result, sourceTrust: 'user-specified' as const }))
  }
  if (scope !== 'official') return results

  return results.map((result, index) => {
    const hostname = getGoalSearchResultDomain(result)
    const label = `${result.title} ${result.source ?? ''}`
    const officialSignalScore = Number(/(?:^|\.)(?:gov|edu)(?:\.[a-z]{2})?$/.test(hostname)) * 4 +
      Number(/官网|官方网站|official/i.test(label)) * 3 +
      Number(/^(?:docs|developer|support)\./.test(hostname)) * 2
    const corroborated = corroboratedDomains.has(hostname)
    const score = officialSignalScore + Number(corroborated)
    const sourceTrust: NonNullable<WebSearchResult['sourceTrust']> = officialSignalScore > 0 && corroborated
      ? 'likely-official'
      : officialSignalScore > 0
        ? 'unverified'
        : 'third-party'
    return { result: { ...result, sourceTrust }, index, score }
  }).sort((left, right) => right.score - left.score || left.index - right.index).map(({ result }) => result)
}
