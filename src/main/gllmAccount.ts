/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import { DEFAULT_PROVIDER_ID, isOfficialGllmApiProvider } from '../shared/providers.ts'
import type { ApiProvider, GllmAccountState } from '../shared/types'

export const GLLM_CONNECT_URL = 'https://llm.gprophet.com/client/connect'
export const GLLM_ACCOUNT_URL = 'https://llm.gprophet.com/api/client/account'
export type AccountFetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

// Deliberately no endpoint/provider/key argument exposed through IPC. Callers
// supply the persisted official record from the main process, never renderer data.
export async function fetchGllmAccount(provider: ApiProvider | undefined, request: AccountFetch, signal?: AbortSignal): Promise<GllmAccountState> {
  if (!provider || provider.id !== DEFAULT_PROVIDER_ID || !isOfficialGllmApiProvider(provider)) return { status: 'disconnected' }
  if (provider.credentialUnavailable) return { status: 'credential-unavailable' }
  if (!provider.apiKey.trim()) return { status: 'disconnected' }
  try {
    const response = await request(GLLM_ACCOUNT_URL, {
      method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${provider.apiKey}`, 'Cache-Control': 'no-store' },
      cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal
    })
    if (response.status === 401 || response.status === 403) return { status: 'unauthorized' }
    if (!response.ok) return { status: 'unavailable' }
    const text = await response.text()
    if (text.length > 8192) return { status: 'unavailable' }
    const body = JSON.parse(text)
    const remainingQuota = body?.data?.remaining_quota, quotaPerUnit = body?.data?.quota_per_unit
    if (body?.success !== true || typeof remainingQuota !== 'number' || !Number.isFinite(remainingQuota)
      || Math.abs(remainingQuota) > Number.MAX_SAFE_INTEGER || typeof quotaPerUnit !== 'number'
      || !Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0 || !Number.isFinite(remainingQuota / quotaPerUnit)) return { status: 'unavailable' }
    return { status: 'ready', remainingQuota, quotaPerUnit, checkedAt: Date.now() }
  } catch { return { status: 'unavailable' } }
}
