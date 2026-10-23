/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { app } from 'electron'
import { join } from 'node:path'

export function getAppIconPath(): string {
  return join(app.isPackaged ? process.resourcesPath : process.cwd(), 'resources', 'app-icon.png')
}
