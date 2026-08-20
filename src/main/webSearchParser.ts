/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { WebSearchResult } from '../shared/types'

function decodeSearchHtml(value: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLocaleLowerCase()
    if (normalized.startsWith('#x')) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16))
    if (normalized.startsWith('#')) return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10))
    return entities[normalized] ?? match
  })
}

function stripSearchHtml(value: string): string {
  return decodeSearchHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function getSearchDomain(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLocaleLowerCase().replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

function getDuckDuckGoResultUrl(value: string): string {
  const decoded = decodeSearchHtml(value).trim()
  try {
    const redirect = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded, 'https://duckduckgo.com')
    const target = redirect.hostname.endsWith('duckduckgo.com') ? redirect.searchParams.get('uddg') : undefined
    return target && /^https?:\/\//i.test(target) ? target : redirect.toString()
  } catch {
    return ''
  }
}

function getGoogleResultUrl(value: string): string {
  const decoded = decodeSearchHtml(value).trim()
  try {
    const link = new URL(decoded, 'https://www.google.com')
    if (/(?:^|\.)google\.[a-z.]+$/i.test(link.hostname)) {
      const target = link.searchParams.get('q') || link.searchParams.get('url')
      return target && /^https?:\/\//i.test(target) ? target : ''
    }
    return /^https?:$/i.test(link.protocol) ? link.toString() : ''
  } catch {
    return ''
  }
}

export function isBlockedGoogleSearchHtml(html: string): boolean {
  return /\/httpservice\/retry\/enablejs|emsg=SG_REL|\/sorry\/index|unusual traffic|detected unusual traffic|consent\.google\.|在继续之前|启用JavaScript|启用 JavaScript/i.test(html)
}

export function parseGoogleSearchResults(html: string): WebSearchResult[] {
  if (isBlockedGoogleSearchHtml(html)) return []
  const anchors = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))
    .filter((match) => /<h3\b/i.test(match[2]))
  const seen = new Set<string>()
  const results: WebSearchResult[] = []

  for (const [index, match] of anchors.entries()) {
    const url = getGoogleResultUrl(match[1])
    if (!url || seen.has(url)) continue
    const titleHtml = match[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? ''
    const title = stripSearchHtml(titleHtml)
    if (!title) continue
    const segmentEnd = anchors[index + 1]?.index ?? html.length
    const segment = html.slice((match.index ?? 0) + match[0].length, segmentEnd)
    const snippetHtml = segment.match(/class=["'][^"']*(?:VwiC3b|IsZvec|yXK7lf)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ''
    seen.add(url)
    results.push({
      title,
      url,
      snippet: stripSearchHtml(snippetHtml),
      sourceDomain: getSearchDomain(url)
    })
    if (results.length >= 10) break
  }
  return results
}

export function parseDuckDuckGoSearchResults(html: string): WebSearchResult[] {
  const anchors = Array.from(html.matchAll(/<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))
  return anchors.slice(0, 10).map((match, index) => {
    const segmentEnd = anchors[index + 1]?.index ?? html.length
    const segment = html.slice(match.index ?? 0, segmentEnd)
    const snippetHtml = segment.match(/class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] ?? ''
    const url = getDuckDuckGoResultUrl(match[1])
    return {
      title: stripSearchHtml(match[2]),
      url,
      snippet: stripSearchHtml(snippetHtml),
      sourceDomain: getSearchDomain(url)
    }
  }).filter((result) => result.title && /^https?:\/\//i.test(result.url))
}
