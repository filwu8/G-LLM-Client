/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 — Change Date: 2030-08-01 */
import { app, safeStorage } from 'electron'
import { resolve } from 'node:path'
import { WorkspaceVault } from './workspaceVault'
let vault: WorkspaceVault | undefined
export function systemSecretCrypto() {
  return {
    available: () => app.isReady() && safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value)
  }
}
export function workspaceVault() {
  return vault ??= new WorkspaceVault(resolve(app.getPath('userData'), 'agent-credentials'), systemSecretCrypto())
}
