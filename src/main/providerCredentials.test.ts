/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import assert from 'node:assert/strict'
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import test from 'node:test'
import { openProviderKey, sealProviderKey, PROVIDER_SECRET_PREFIX } from './providerCredentials.ts'

test('encrypted provider records round-trip without plaintext and remain locked under another OS key', () => {
  const crypto = (key: Buffer) => ({ available: () => true,
    encrypt: (value: string) => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]) },
    decrypt: (value: Buffer) => { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8') }
  })
  const os = crypto(randomBytes(32)), key = 'fixture-only-personal-key'
  const stored = sealProviderKey(key, os)
  assert.ok(stored.startsWith(PROVIDER_SECRET_PREFIX))
  assert.equal(stored.includes(key), false)
  assert.deepEqual(openProviderKey(stored, os), { key, unavailable: false })
  assert.deepEqual(openProviderKey(stored, crypto(randomBytes(32))), { key: '', unavailable: true })
})
test('no plaintext fallback or silent credential erasure when secure storage is unavailable', () => {
  const unavailable = { available: () => false, encrypt: () => { throw new Error('must not run') }, decrypt: () => { throw new Error('must not run') } }
  assert.throws(() => sealProviderKey('fixture-only-key', unavailable), /encryption is unavailable/)
  assert.equal(sealProviderKey('', unavailable), '')
  assert.deepEqual(openProviderKey(PROVIDER_SECRET_PREFIX + 'invalid!', unavailable), { key: '', unavailable: true })
})
