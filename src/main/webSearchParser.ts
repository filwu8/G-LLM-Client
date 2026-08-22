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

function normalizePageHost(value: string): string {
  return value.toLocaleLowerCase().replace(/^www\./, '')
}

export interface SearchPageLink {
  title: string
  url: string
}

/** Extract a few useful first-party pages from an explicitly requested site. */
export function extractSameSitePageLinks(
  html: string,
  baseUrl: string,
  requestedDomain: string,
  limit = 4
): SearchPageLink[] {
  const requestedHost = normalizePageHost(requestedDomain)
  const usefulPattern = /about|company|product|feature|service|solution|docs?|guide|help|security|privacy|pricing|news|blog|case|介绍|关于|产品|功能|服务|方案|文档|帮助|安全|隐私|价格|新闻|博客|案例/i
  const excludedPattern = /login|logout|sign[-_]?in|register|auth|account|search|tag|category|javascript:|mailto:|tel:/i
  const assetPattern = /\.(?:png|jpe?g|gif|webp|svg|ico|pdf|zip|dmg|exe|mp4|mp3)(?:$|[?#])/i
  const seen = new Set<string>()
  const candidates: Array<SearchPageLink & { score: number }> = []

  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const rawHref = decodeSearchHtml(match[1]).trim()
    const title = stripSearchHtml(match[2]).slice(0, 120)
    if (!rawHref || excludedPattern.test(rawHref) || assetPattern.test(rawHref)) continue
    try {
      const url = new URL(rawHref, baseUrl)
      if (!/^https?:$/.test(url.protocol)) continue
      const host = normalizePageHost(url.hostname)
      if (host !== requestedHost && !host.endsWith(`.${requestedHost}`)) continue
      url.hash = ''
      url.search = ''
      const normalized = url.toString().replace(/\/$/, '')
      if (!normalized || normalized === baseUrl.replace(/\/$/, '') || seen.has(normalized)) continue
      seen.add(normalized)
      const signal = `${url.pathname} ${title}`
      const score = (usefulPattern.test(signal) ? 10 : 0) + (title.length >= 4 ? 2 : 0) - Math.min(4, url.pathname.split('/').length - 2)
      candidates.push({ title: title || requestedHost, url: normalized, score })
    } catch {
      // Ignore malformed links in third-party HTML.
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(0, limit))
    .map(({ title, url }) => ({ title, url }))
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
