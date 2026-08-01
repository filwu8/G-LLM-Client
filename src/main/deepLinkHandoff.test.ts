/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GLLM_HANDOFF_EXCHANGE_URL,
  exchangeGllmHandoff,
  resolveGllmHandoffExchangeUrl
} from './deepLinkHandoff.ts'

const code = 'a'.repeat(64)
const apiKey = `sk-${'b'.repeat(48)}`

test('exchanges the one-time code in a no-store POST body', async () => {
  let requestBody = ''
  const result = await exchangeGllmHandoff(code, {
    request: async (url, init) => {
      assert.equal(url, GLLM_HANDOFF_EXCHANGE_URL)
      assert.equal(init.method, 'POST')
      assert.equal(init.cache, 'no-store')
      assert.equal(init.credentials, 'omit')
      assert.equal(init.redirect, 'error')
      requestBody = String(init.body)
      return {
        ok: true,
        text: async () => JSON.stringify({ success: true, data: { api_key: apiKey } })
      }
    }
  })

  assert.deepEqual(JSON.parse(requestBody), { code })
  assert.deepEqual(result, { apiKey })
})

test('rejects malformed codes and invalid API key responses', async () => {
  await assert.rejects(
    exchangeGllmHandoff('short', {
      request: async () => ({ ok: true, text: async () => '{}' })
    }),
    /Invalid G-LLM handoff code/
  )
  await assert.rejects(
    exchangeGllmHandoff(code, {
      request: async () => ({
        ok: true,
        text: async () => JSON.stringify({ success: true, data: { api_key: 'sk-secret' } })
      })
    }),
    /valid API key/
  )
})

test('only permits safe development endpoint overrides', () => {
  assert.equal(resolveGllmHandoffExchangeUrl(false, 'http://localhost:3000/api/client/handoff/exchange'), GLLM_HANDOFF_EXCHANGE_URL)
  assert.equal(
    resolveGllmHandoffExchangeUrl(true, 'http://localhost:3000/api/client/handoff/exchange'),
    'http://localhost:3000/api/client/handoff/exchange'
  )
  assert.equal(resolveGllmHandoffExchangeUrl(true, 'http://example.com/exchange'), GLLM_HANDOFF_EXCHANGE_URL)
  assert.equal(resolveGllmHandoffExchangeUrl(true, 'https://user@example.com/exchange'), GLLM_HANDOFF_EXCHANGE_URL)
})
