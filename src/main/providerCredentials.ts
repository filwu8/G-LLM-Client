/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
export const PROVIDER_SECRET_PREFIX = 'gllm-os-encrypted:v1:'
export interface ProviderSecretCrypto {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

export function sealProviderKey(key: string, crypto: ProviderSecretCrypto): string {
  if (!key) return ''
  if (!crypto.available()) throw new Error('System credential encryption is unavailable. Unlock your OS account and retry.')
  try {
    const encrypted = crypto.encrypt(key)
    if (crypto.decrypt(encrypted) !== key) throw new Error('roundtrip')
    return PROVIDER_SECRET_PREFIX + encrypted.toString('base64')
  } catch { throw new Error('Could not securely save the provider credential. No plaintext fallback was used.') }
}

export function openProviderKey(stored: string, crypto: ProviderSecretCrypto): { key: string; unavailable: boolean } {
  if (!stored) return { key: '', unavailable: false }
  if (!crypto.available()) return { key: '', unavailable: true }
  if (!stored.startsWith(PROVIDER_SECRET_PREFIX)) return { key: stored, unavailable: false }
  try {
    const encoded = stored.slice(PROVIDER_SECRET_PREFIX.length)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('invalid encoding')
    const key = crypto.decrypt(Buffer.from(encoded, 'base64'))
    if (!key) throw new Error('empty credential')
    return { key, unavailable: false }
  } catch { return { key: '', unavailable: true } }
}
