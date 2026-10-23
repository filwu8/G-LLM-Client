/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Electron starts this file directly, so restore the package metadata that it
// normally reads when starting a package directory. Keep the same data/profile
// identity and resource root while loading the isolated development output.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
app.setAppPath(fileURLToPath(new URL('.', import.meta.url)))
app.setName(pkg.productName || pkg.name)
app.setVersion(pkg.version)
app.setDesktopName(pkg.desktopName || `${pkg.name}.desktop`)

await import('./.electron-vite/main/index.js')
