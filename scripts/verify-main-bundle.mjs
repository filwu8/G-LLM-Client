/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const mainOutputDirectory = resolve('out/main')
const javascriptFiles = readdirSync(mainOutputDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => resolve(mainOutputDirectory, entry.name))

if (javascriptFiles.length === 0) {
  throw new Error(`No main-process JavaScript files found in ${mainOutputDirectory}`)
}

const externalJsZipPattern = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"]jszip(?:\/[^'"]*)?['"]/u
const offendingFiles = javascriptFiles.filter((filePath) => externalJsZipPattern.test(readFileSync(filePath, 'utf8')))

if (offendingFiles.length > 0) {
  throw new Error(`JSZip must be bundled for ASAR compatibility; found external imports in: ${offendingFiles.join(', ')}`)
}

console.log(`Verified ${javascriptFiles.length} main-process bundles: JSZip is bundled for ASAR compatibility.`)
