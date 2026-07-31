/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

export const GLLM_DEEP_LINK_SCHEME = 'gllm'

export interface GllmDeepLink {
  action: 'open'
  source?: 'new-api'
}

export type GllmDeepLinkArgumentResult =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'valid'; link: GllmDeepLink }

const MAX_DEEP_LINK_LENGTH = 256
const ALLOWED_BASE_URLS = new Set(['gllm://open', 'gllm://open/'])
const ALLOWED_QUERY = 'source=new-api'

function isPotentialGllmDeepLink(value: string): boolean {
  return value.slice(0, `${GLLM_DEEP_LINK_SCHEME}:`.length).toLowerCase() === `${GLLM_DEEP_LINK_SCHEME}:`
}

/**
 * Parse the deliberately small public deep-link surface.
 *
 * The raw URL is checked before URL normalization so encoded paths, duplicate
 * parameters, fragments, credentials and other alternate representations
 * cannot be normalized into an accepted action.
 */
export function parseGllmDeepLink(value: string): GllmDeepLink | null {
  if (!value || value.length > MAX_DEEP_LINK_LENGTH || value.trim() !== value) return null

  const queryIndex = value.indexOf('?')
  const rawBase = queryIndex === -1 ? value : value.slice(0, queryIndex)
  const rawQuery = queryIndex === -1 ? '' : value.slice(queryIndex + 1)

  if (!ALLOWED_BASE_URLS.has(rawBase.toLowerCase())) return null
  if (queryIndex !== -1 && rawQuery !== ALLOWED_QUERY) return null

  try {
    const url = new URL(value)
    if (url.protocol.toLowerCase() !== `${GLLM_DEEP_LINK_SCHEME}:`) return null
    if (url.hostname.toLowerCase() !== 'open') return null
    if (url.pathname !== '' && url.pathname !== '/') return null
    if (url.username || url.password || url.port || url.hash) return null

    const parameters = [...url.searchParams.entries()]
    if (parameters.length === 0) return { action: 'open' }
    if (parameters.length !== 1) return null
    if (parameters[0][0] !== 'source' || parameters[0][1] !== 'new-api') return null

    return { action: 'open', source: 'new-api' }
  } catch {
    return null
  }
}

/**
 * Chromium may add or reorder process arguments. Ignore unrelated arguments,
 * but reject ambiguous launches containing multiple G-LLM URL candidates.
 */
export function inspectGllmDeepLinkArguments(args: readonly string[]): GllmDeepLinkArgumentResult {
  const candidates = args.filter(isPotentialGllmDeepLink)
  if (candidates.length === 0) return { kind: 'none' }
  if (candidates.length !== 1) return { kind: 'invalid' }

  const link = parseGllmDeepLink(candidates[0])
  return link ? { kind: 'valid', link } : { kind: 'invalid' }
}
