/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PROVIDER } from '../shared/providers.ts'
import { fetchGllmAccount, GLLM_ACCOUNT_URL } from './gllmAccount.ts'

const provider = { ...DEFAULT_PROVIDER, apiKey: 'fixture-personal-credential' }
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(body) })
test('account uses only the fixed official endpoint and persisted personal credential', async () => {
  const account = await fetchGllmAccount(provider, async (url, init) => {
    assert.equal(url, GLLM_ACCOUNT_URL)
    assert.equal(init.method, 'GET')
    assert.equal(init.redirect, 'error')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.cache, 'no-store')
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${provider.apiKey}`)
    assert.equal(init.body, undefined)
    assert.equal(url.includes(provider.apiKey), false)
    return response({ success: true, data: { remaining_quota: 100, quota_per_unit: 200 } })
  })
  assert.equal(account.status, 'ready')
  if (account.status === 'ready') assert.equal(account.remainingQuota / account.quotaPerUnit, 0.5)
  assert.equal(JSON.stringify(account).includes(provider.apiKey), false)
})
test('custom URLs, embedded credentials and renderer-like provider overrides never receive an account request', async () => {
  let calls = 0
  const request = async () => { calls++; return response({}) }
  for (const next of [undefined, { ...provider, id: 'custom' }, { ...provider, apiBaseUrl: 'https://example.com/v1' },
    { ...provider, apiBaseUrl: 'https://other:password@llm.gprophet.com/v1' }, { ...provider, apiBaseUrl: provider.apiBaseUrl + '?redirect=evil' }, { ...provider, apiKey: '' }]) {
    assert.equal((await fetchGllmAccount(next, request)).status, 'disconnected')
  }
  assert.equal((await fetchGllmAccount({ ...provider, credentialUnavailable: true }, request)).status, 'credential-unavailable')
  assert.equal(calls, 0)
})
test('zero balance, revoked tokens, redirects, malformed/SPA responses and transient failure never clear credentials', async () => {
  const zero = await fetchGllmAccount(provider, async () => response({ success: true, data: { remaining_quota: 0, quota_per_unit: 10 } }))
  assert.equal(zero.status, 'ready')
  if (zero.status === 'ready') assert.equal(zero.remainingQuota, 0)
  assert.equal((await fetchGllmAccount(provider, async () => response({}, 401))).status, 'unauthorized')
  assert.equal((await fetchGllmAccount(provider, async () => response({}, 403))).status, 'unauthorized')
  for (const body of [{ success: true, data: { remaining_quota: 10, quota_per_unit: 0 } }, { success: false }, { success: true, data: { remaining_quota: '100', quota_per_unit: 20 } }]) {
    assert.equal((await fetchGllmAccount(provider, async () => response(body))).status, 'unavailable')
  }
  assert.equal((await fetchGllmAccount(provider, async () => ({ ok: true, status: 200, text: async () => '<html>SPA fallback</html>' }))).status, 'unavailable')
  assert.equal((await fetchGllmAccount(provider, async () => response({}, 302))).status, 'unavailable')
  assert.equal((await fetchGllmAccount(provider, async () => { throw new Error('network / redirect blocked') })).status, 'unavailable')
  assert.equal(provider.apiKey, 'fixture-personal-credential')
  assert.equal((await fetchGllmAccount(provider, async () => response({ success: true, data: { remaining_quota: 1, quota_per_unit: 10 } }))).status, 'ready')
})

test('429 honors Retry-After and refreshes during the cooldown make no network request', async () => {
  const start = Date.now()
  const limited = await fetchGllmAccount(provider, async () => ({
    ...response({}, 429), headers: new Headers({ 'Retry-After': '90' })
  }))
  assert.equal(limited.status, 'rate-limited')
  if (limited.status !== 'rate-limited') return
  assert.ok(limited.retryAt >= start + 90_000)
  let calls = 0
  const request = async () => { calls++; return response({}, 401) }
  assert.deepEqual(await fetchGllmAccount(provider, request, undefined, limited.retryAt), limited)
  assert.equal(calls, 0)
  assert.equal((await fetchGllmAccount(provider, request, undefined, start - 1)).status, 'unauthorized')
  assert.equal(calls, 1)
})
