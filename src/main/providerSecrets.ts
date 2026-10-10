/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import type { ApiProvider } from '../shared/types'

export interface SecretCipher {
  available: () => boolean
  encrypt: (value: string) => Buffer
  decrypt: (value: Buffer) => string
}

export type StoredProvider = ApiProvider & { encryptedApiKey?: string }

export function sealProvider(provider: ApiProvider | StoredProvider, cipher: SecretCipher): StoredProvider {
  const { encryptedApiKey, ...rest } = provider as StoredProvider
  const apiKey = rest.apiKey ?? ''
  if (!apiKey) return encryptedApiKey ? { ...rest, apiKey: '', encryptedApiKey } : { ...rest, apiKey: '' }
  if (!cipher.available()) return { ...rest, apiKey }
  return { ...rest, apiKey: '', encryptedApiKey: cipher.encrypt(apiKey).toString('base64') }
}

export function openProvider(provider: StoredProvider, cipher: SecretCipher): ApiProvider {
  const { encryptedApiKey, ...rest } = provider
  if (!encryptedApiKey) return { ...rest, apiKey: rest.apiKey ?? '' }
  try {
    if (cipher.available()) return { ...rest, apiKey: cipher.decrypt(Buffer.from(encryptedApiKey, 'base64')) }
  } catch {
    // Ciphertext from another device or OS account cannot be decrypted; the user must re-enter the key.
  }
  return { ...rest, apiKey: '' }
}

export function needsSealing(provider: StoredProvider, cipher: SecretCipher): boolean {
  return Boolean(provider.apiKey) && cipher.available()
}
