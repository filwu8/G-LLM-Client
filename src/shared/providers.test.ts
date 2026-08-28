/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROVIDER_MODEL_CATALOG_TTL_MS,
  applyFetchedProviderModels,
  isLocalNetworkApiBaseUrl,
  isProviderApiKeyMissing,
  resolveProviderModelId,
  shouldRefreshProviderModels
} from './providers.ts'
import type { ApiProvider } from './types.ts'

function createProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'provider_gllm',
    templateId: 'gllm',
    name: 'G-LLM',
    apiBaseUrl: 'https://llm.gprophet.com/v1',
    apiKey: 'sk-test',
    defaultModel: 'available-default',
    models: [{ id: 'available-default' }, { id: 'available-new' }],
    requiresApiKey: true,
    ...overrides
  }
}

test('official G-LLM provider falls back when a requested model is no longer listed', () => {
  const provider = createProvider()

  assert.equal(resolveProviderModelId(provider, 'removed-model'), 'available-default')
})

test('official G-LLM provider falls back to the first model when its default is stale', () => {
  const provider = createProvider({ defaultModel: 'removed-default' })

  assert.equal(resolveProviderModelId(provider, 'removed-model'), 'available-default')
})

test('custom compatible providers preserve manually entered model IDs', () => {
  const provider = createProvider({
    id: 'provider_custom',
    templateId: 'openai-compatible',
    apiBaseUrl: 'https://example.com/v1'
  })

  assert.equal(resolveProviderModelId(provider, 'manual-model'), 'manual-model')
})

test('fetched models replace the catalog and reconcile a stale default', () => {
  const updatedAt = 123_456
  const provider = createProvider({ defaultModel: 'removed-default' })
  const refreshed = applyFetchedProviderModels(provider, [{ id: 'available-new' }], updatedAt)

  assert.deepEqual(refreshed.models, [{ id: 'available-new' }])
  assert.equal(refreshed.defaultModel, 'available-new')
  assert.equal(refreshed.modelsUpdatedAt, updatedAt)
})

test('only stale official G-LLM catalogs with credentials are refreshed automatically', () => {
  const now = 2 * PROVIDER_MODEL_CATALOG_TTL_MS
  const current = createProvider({ modelsUpdatedAt: now - PROVIDER_MODEL_CATALOG_TTL_MS + 1 })
  const stale = createProvider({ modelsUpdatedAt: now - PROVIDER_MODEL_CATALOG_TTL_MS })
  const custom = createProvider({
    id: 'provider_custom',
    templateId: 'openai-compatible',
    apiBaseUrl: 'https://example.com/v1',
    modelsUpdatedAt: 0
  })

  assert.equal(shouldRefreshProviderModels(current, now), false)
  assert.equal(shouldRefreshProviderModels(stale, now), true)
  assert.equal(shouldRefreshProviderModels(createProvider({ apiKey: '', modelsUpdatedAt: 0 }), now), false)
  assert.equal(shouldRefreshProviderModels(custom, now), false)
})

test('detects local and private-network API endpoints', () => {
  assert.equal(isLocalNetworkApiBaseUrl('http://localhost:11434/v1'), true)
  assert.equal(isLocalNetworkApiBaseUrl('http://127.0.0.1:1234/v1'), true)
  assert.equal(isLocalNetworkApiBaseUrl('http://192.168.88.202:6001/v1'), true)
  assert.equal(isLocalNetworkApiBaseUrl('http://172.20.1.8/v1'), true)
  assert.equal(isLocalNetworkApiBaseUrl('http://model-server.lan/v1'), true)
  assert.equal(isLocalNetworkApiBaseUrl('https://api.openai.com/v1'), false)
  assert.equal(isLocalNetworkApiBaseUrl('not a url'), false)
})

test('legacy local providers can connect without an API key', () => {
  assert.equal(isProviderApiKeyMissing(createProvider({
    apiBaseUrl: 'http://192.168.88.202:6001/v1',
    apiKey: '',
    requiresApiKey: true
  })), false)
  assert.equal(isProviderApiKeyMissing(createProvider({
    apiBaseUrl: 'https://api.example.com/v1',
    apiKey: '',
    requiresApiKey: true
  })), true)
})
