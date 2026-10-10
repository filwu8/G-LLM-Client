/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { needsSealing, openProvider, sealProvider, type SecretCipher } from './providerSecrets.ts'
import type { ApiProvider } from '../shared/types'

function createCipher(key = randomBytes(32), available = true): SecretCipher {
  return {
    available: () => available,
    encrypt: (value) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), body])
    },
    decrypt: (value) => {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      decipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')
    }
  }
}

const provider: ApiProvider = {
  id: 'custom',
  templateId: 'openai-compatible',
  name: 'Custom',
  apiBaseUrl: 'https://example.com/v1',
  apiKey: 'sk-high-entropy-test-secret',
  defaultModel: 'model',
  models: [{ id: 'model' }],
  requiresApiKey: true
}

test('sealed providers never persist the plaintext key and round-trip through openProvider', () => {
  const cipher = createCipher()
  const sealed = sealProvider(provider, cipher)
  assert.equal(sealed.apiKey, '')
  assert.ok(sealed.encryptedApiKey)
  assert.doesNotMatch(JSON.stringify(sealed), /sk-high-entropy-test-secret/)
  assert.equal(needsSealing(sealed, cipher), false)

  const opened = openProvider(sealed, cipher)
  assert.equal(opened.apiKey, provider.apiKey)
  assert.equal('encryptedApiKey' in opened, false)
  assert.deepEqual(sealProvider(opened, cipher).apiKey, '')
})

test('legacy plaintext keys are readable and flagged for migration', () => {
  const cipher = createCipher()
  assert.equal(needsSealing(provider, cipher), true)
  assert.equal(openProvider(provider, cipher).apiKey, provider.apiKey)
})

test('falls back to plaintext only when OS encryption is unavailable', () => {
  const unavailable = createCipher(randomBytes(32), false)
  const sealed = sealProvider(provider, unavailable)
  assert.equal(sealed.apiKey, provider.apiKey)
  assert.equal(sealed.encryptedApiKey, undefined)
  assert.equal(needsSealing(sealed, unavailable), false)
})

test('ciphertext from another device yields an empty key instead of throwing', () => {
  const sealed = sealProvider(provider, createCipher())
  assert.equal(openProvider(sealed, createCipher()).apiKey, '')
  assert.equal(openProvider(sealed, createCipher(randomBytes(32), false)).apiKey, '')
})

test('clearing a key removes stored ciphertext', () => {
  const cipher = createCipher()
  const sealed = sealProvider(provider, cipher)
  const cleared = sealProvider({ ...openProvider(sealed, cipher), apiKey: '' }, cipher)
  assert.equal(cleared.encryptedApiKey, undefined)
  assert.equal(cleared.apiKey, '')
})
