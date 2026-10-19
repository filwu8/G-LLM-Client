/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import mammoth from 'mammoth'
import { createDocxDocument } from './docxDocument.ts'

const require = createRequire(import.meta.url)
const mermaidRequire = createRequire(require.resolve('mermaid'))
const katex = mermaidRequire('katex')

test('math rendering ignores an inherited trust setting and rejects javascript links', () => {
  const options = Object.assign(Object.create({ trust: true }), { throwOnError: false })
  const html = katex.renderToString('\\href{javascript:alert(1)}{click}', options)
  assert.doesNotMatch(html, /href\s*=\s*["']javascript:/i)
  assert.match(katex.renderToString('x^2 + y^2'), /katex/)
})

test('Word extraction and HTML conversion remain compatible with the updated CLI dependency', async () => {
  const { buffer } = await createDocxDocument('Security regression', '中文 document content', 'G-LLM')
  assert.match((await mammoth.extractRawText({ buffer })).value, /中文 document content/)
  assert.match((await mammoth.convertToHtml({ buffer })).value, /中文 document content/)
})

test('Mammoth command-line help remains compatible after removing the sprintf dependency chain', () => {
  const entry = resolve(dirname(require.resolve('mammoth')), '../bin/mammoth')
  const output = execFileSync(process.execPath, [entry, '--help'], { encoding: 'utf8', timeout: 10_000 })
  assert.match(output, /--output-format/)
  assert.match(output, /docx-path/)
})
