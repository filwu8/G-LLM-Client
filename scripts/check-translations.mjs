/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localeFiles = ['zh-CN.json', 'en-US.json']
const assistantPresetLocaleFiles = ['en-US.json']

function flattenKeys(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child && typeof child === 'object' && !Array.isArray(child) ? flattenKeys(child, path) : [path]
  })
}

const locales = await Promise.all(
  localeFiles.map(async (file) => ({
    file,
    value: JSON.parse(await readFile(resolve(root, 'src/shared/locales', file), 'utf8'))
  }))
)

const referenceKeys = new Set(flattenKeys(locales[0].value))
let failed = false

for (const locale of locales.slice(1)) {
  const keys = new Set(flattenKeys(locale.value))
  const missing = [...referenceKeys].filter((key) => !keys.has(key))
  const extra = [...keys].filter((key) => !referenceKeys.has(key))

  if (missing.length || extra.length) {
    failed = true
    console.error(`${locale.file}: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`)
  }
}

const assistantPresetSource = await readFile(resolve(root, 'src/shared/assistantPresets.ts'), 'utf8')
const assistantPresetIds = [...assistantPresetSource.matchAll(/preset\(\r?\n\s*'([^']+)'/g)].map((match) => match[1])
const assistantPresetIdSet = new Set(assistantPresetIds)

for (const file of assistantPresetLocaleFiles) {
  const catalog = JSON.parse(
    await readFile(resolve(root, 'src/shared/locales/assistant-presets', file), 'utf8')
  )
  const catalogIds = Object.keys(catalog)
  const missing = assistantPresetIds.filter((id) => !catalog[id])
  const extra = catalogIds.filter((id) => !assistantPresetIdSet.has(id))
  const incomplete = catalogIds.filter((id) =>
    !['name', 'title', 'description'].every((field) => typeof catalog[id]?.[field] === 'string' && catalog[id][field].trim())
  )

  if (missing.length || extra.length || incomplete.length) {
    failed = true
    console.error(
      `assistant-presets/${file}: missing [${missing.join(', ')}], extra [${extra.join(', ')}], incomplete [${incomplete.join(', ')}]`
    )
  }
}

if (failed) process.exit(1)
console.log(
  `Validated ${referenceKeys.size} translation keys across ${localeFiles.length} locales and ${assistantPresetIds.length} assistant presets.`
)
