/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { GllmConnection } from './gllmConnection.ts'
import { DEFAULT_PROVIDER } from '../shared/providers.ts'
import { GLLM_CONNECT_URL } from './gllmAccount.ts'
import { exchangeGllmHandoff } from './deepLinkHandoff.ts'
import type { ApiProvider, DeepLinkHandoffStatusEvent } from '../shared/types'

function fixture(waitMs = 180_000) {
  let saved: ApiProvider | undefined, exchanges = 0, activations = 0, fetches = 0
  let mode = 'success'
  const events: DeepLinkHandoffStatusEvent[] = []
  const connection = new GllmConnection({
    openBrowser: async url => { assert.equal(url, GLLM_CONNECT_URL) },
    exchange: async code => { exchanges++; if (mode === 'expired') throw new Error('expired or used'); if (mode === 'network') throw new Error('network'); return { apiKey: 'personal-' + code } },
    getProvider: () => saved,
    saveProvider: provider => { if (mode === 'storage') throw new Error('locked'); return saved = { ...provider } },
    fetchModels: async provider => { fetches++; assert.equal(provider.apiBaseUrl, DEFAULT_PROVIDER.apiBaseUrl); assert.equal(provider.modelsPath, undefined); if (mode === 'models') throw new Error('network'); return [{ id: 'embedding', type: 'embedding' }, { id: 'available-chat', type: 'chat' }] },
    activate: () => { activations++ }, notify: event => events.push(event)
  }, waitMs)
  return { connection, events, setMode: (value: string) => { mode = value }, saved: () => saved, counts: () => ({ exchanges, activations, fetches }) }
}
test('cold callback imports its own key, chooses a fetched chat model, activates and deduplicates callbacks', async () => {
  const f = fixture(), code = 'a'.repeat(64)
  await f.connection.receive(code)
  assert.equal(f.connection.getState().status, 'success')
  assert.equal(f.saved()?.defaultModel, 'available-chat')
  assert.equal(f.saved()?.apiKey, 'personal-' + code)
  await f.connection.receive(code)
  assert.deepEqual(f.counts(), { exchanges: 1, activations: 1, fetches: 1 })
  assert.deepEqual(f.events.map(e => e.status), ['exchanging', 'models', 'success'])
  assert.equal(JSON.stringify(f.events).includes(code), false)
})
test('expired/used codes and network errors are recoverable and do not alter an existing account', async () => {
  const f = fixture(); await f.connection.receive('a'.repeat(64)); const existing = f.saved()?.apiKey
  for (const mode of ['expired', 'network', 'storage']) {
    f.setMode(mode); await f.connection.receive('b'.repeat(64)); assert.equal(f.connection.getState().status, 'error'); assert.equal(f.saved()?.apiKey, existing)
  }
  f.setMode('success'); await f.connection.retry(); await f.connection.receive('c'.repeat(64))
  assert.equal(f.connection.getState().status, 'success')
})
test('model refresh retry retains the consumed-code credential and does not exchange or issue allowance again', async () => {
  const f = fixture(); f.setMode('models'); await f.connection.receive('d'.repeat(64))
  assert.deepEqual(f.connection.getState(), { status: 'error', reason: 'models' })
  assert.ok(f.saved()?.apiKey)
  f.setMode('success'); await f.connection.retry()
  assert.equal(f.connection.getState().status, 'success')
  assert.equal(f.counts().exchanges, 1)
})

test('exchange 429 stops repeated browser launches and new callbacks during the server cooldown', async () => {
  let requests = 0, browserOpens = 0
  const connection = new GllmConnection({
    openBrowser: async () => { browserOpens++ },
    exchange: (code, signal) => exchangeGllmHandoff(code, {
      signal,
      request: async () => {
        requests++
        return new Response(null, { status: 429, headers: { 'Retry-After': '45' } })
      }
    }),
    getProvider: () => undefined,
    saveProvider: () => assert.fail('a rate-limited exchange cannot save a key'),
    fetchModels: async () => [], activate: () => {}, notify: () => {}
  })
  await connection.begin()
  await connection.receive('a'.repeat(64))
  const state = connection.getState()
  assert.equal(state.reason, 'rateLimit')
  assert.ok(state.retryAt && state.retryAt > Date.now())
  await connection.retry()
  await connection.receive('b'.repeat(64))
  assert.deepEqual(connection.getState(), state)
  assert.equal(browserOpens, 1)
  assert.equal(requests, 1)
})
test('cancel rejects late callbacks, and waiting timeout allows explicit retry', async () => {
  const f = fixture(10); await f.connection.begin(); f.connection.cancel(); await f.connection.receive('e'.repeat(64))
  assert.equal(f.saved(), undefined)
  assert.equal(f.connection.getState().status, 'cancelled')
  await f.connection.begin(); await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(f.connection.getState().status, 'expired')
  await f.connection.receive('e'.repeat(64)); assert.equal(f.counts().exchanges, 0)
  await f.connection.retry(); await f.connection.receive('e'.repeat(64)); assert.equal(f.connection.getState().status, 'success')
})
test('cancelling an in-flight exchange cannot write a credential after its result arrives', async () => {
  let finish!: (value: { apiKey: string }) => void, writes = 0
  const connection = new GllmConnection({ openBrowser: async () => {}, exchange: () => new Promise(resolve => { finish = resolve }),
    getProvider: () => undefined, saveProvider: provider => { writes++; return provider }, fetchModels: async () => [], activate: () => {}, notify: () => {} })
  const receive = connection.receive('f'.repeat(64)); connection.cancel(); finish({ apiKey: 'fixture-key' }); await receive
  assert.equal(writes, 0); assert.equal(connection.getState().status, 'cancelled')
})

test('an older model response cannot overwrite a newer account connection', async () => {
  let saved: ApiProvider | undefined, resolveOld!: (models: Array<{ id: string }>) => void, activations = 0
  const connection = new GllmConnection({ openBrowser: async () => {}, exchange: async code => ({ apiKey: code }), getProvider: () => saved,
    saveProvider: provider => saved = provider,
    fetchModels: async provider => provider.apiKey === 'old' ? new Promise(resolve => { resolveOld = resolve }) : [{ id: 'new-model' }],
    activate: () => { activations++ }, notify: () => {} })
  const old = connection.receive('old')
  await new Promise(resolve => setImmediate(resolve))
  await connection.receive('new')
  resolveOld([{ id: 'stale-model' }]); await old
  assert.equal(saved?.apiKey, 'new'); assert.equal(saved?.defaultModel, 'new-model'); assert.equal(activations, 1)
})
