/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { app, safeStorage } from 'electron'
import { resolve } from 'node:path'
import { WorkspaceVault } from './workspaceVault'
let vault: WorkspaceVault | undefined
export function workspaceVault() {
  return vault ??= new WorkspaceVault(resolve(app.getPath('userData'), 'agent-credentials'), {
    available: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: value => safeStorage.encryptString(value),
    decrypt: value => safeStorage.decryptString(value)
  })
}
