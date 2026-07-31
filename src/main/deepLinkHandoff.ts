/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

export const GLLM_HANDOFF_EXCHANGE_URL = 'https://llm.gprophet.com/api/client/handoff/exchange'

const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9]{64}$/
const API_KEY_PATTERN = /^sk-[A-Za-z0-9]{48}$/
const MAX_RESPONSE_LENGTH = 4096

interface HandoffFetchResponse {
  ok: boolean
  text: () => Promise<string>
}

export type HandoffFetch = (url: string, init: RequestInit) => Promise<HandoffFetchResponse>

export interface ExchangeGllmHandoffOptions {
  request: HandoffFetch
  signal?: AbortSignal
  endpoint?: string
}

export function resolveGllmHandoffExchangeUrl(isDevelopment: boolean, override?: string): string {
  if (!isDevelopment || !override?.trim()) return GLLM_HANDOFF_EXCHANGE_URL

  try {
    const url = new URL(override.trim())
    const isLocalDevelopmentHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if ((url.protocol === 'https:' || (url.protocol === 'http:' && isLocalDevelopmentHost)) &&
      url.username === '' && url.password === '' && url.hash === '') {
      return url.toString()
    }
  } catch {
    // Fall back to the fixed production endpoint.
  }

  return GLLM_HANDOFF_EXCHANGE_URL
}

export async function exchangeGllmHandoff(
  code: string,
  options: ExchangeGllmHandoffOptions
): Promise<{ apiKey: string }> {
  if (!HANDOFF_CODE_PATTERN.test(code)) throw new Error('Invalid G-LLM handoff code')

  const response = await options.request(options.endpoint ?? GLLM_HANDOFF_EXCHANGE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: options.signal
  })
  const text = await response.text()
  if (!response.ok || text.length > MAX_RESPONSE_LENGTH) throw new Error('G-LLM handoff exchange failed')

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('G-LLM handoff response was invalid')
  }

  const apiKey =
    payload && typeof payload === 'object' && 'success' in payload && payload.success === true &&
    'data' in payload && payload.data && typeof payload.data === 'object' && 'api_key' in payload.data
      ? payload.data.api_key
      : undefined
  if (typeof apiKey !== 'string' || !API_KEY_PATTERN.test(apiKey)) {
    throw new Error('G-LLM handoff response did not contain a valid API key')
  }

  return { apiKey }
}
