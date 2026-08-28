/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // JSZip declares an extensionless CommonJS entry (./lib/index). Electron's
    // ESM loader can resolve it during development but misresolves it to
    // jszip/index.js from inside app.asar. Bundle it into the main process so
    // packaged workspace and archive tasks do not depend on ASAR package lookup.
    plugins: [externalizeDepsPlugin({ exclude: ['jszip'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    }
  }
})
