/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { stabilizeAdjacentStrongDelimiters } from './markdownStrongBoundary.ts'

function renderMarkdown(content: string): string {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, stabilizeAdjacentStrongDelimiters(content))
  )
}

test('renders strong labels that touch following Chinese text', () => {
  const html = renderMarkdown('**结论：**如果今天发布新模型。\n\n**下一步：**请确认供应商。')

  assert.match(html, /<strong>结论：<\/strong>/)
  assert.match(html, /<strong>下一步：<\/strong>/)
  assert.doesNotMatch(html, /\*\*结论/)
})

test('renders strong labels that touch following English text', () => {
  const html = renderMarkdown('**Note:**Read this first.')

  assert.match(html, /<strong>Note:<\/strong>/)
  assert.doesNotMatch(html, /\*\*Note/)
})

test('does not rewrite fenced or inline code', () => {
  const markdown = ['```markdown', '**结论：**如果', '```', '', '`**下一步：**请确认`'].join('\n')

  assert.equal(stabilizeAdjacentStrongDelimiters(markdown), markdown)
})

test('leaves already valid strong Markdown unchanged', () => {
  const markdown = '**核验依据与边界：**\n\n**结论：** 如果今天发布新模型。'

  assert.equal(stabilizeAdjacentStrongDelimiters(markdown), markdown)
})

test('does not confuse adjacent strong spans on the same line', () => {
  const markdown =
    '截至 **2026年8月24日**，现有资料**无法可靠确认今天的精确报价**。在岸价格升破 **6.75**，并于 **8月21日**创新高。'
  const html = renderMarkdown(markdown)

  assert.equal((html.match(/<strong>/g) ?? []).length, 4)
  assert.doesNotMatch(html, /\*\*/)
})

test('keeps escaped and unmatched markers literal', () => {
  assert.equal(stabilizeAdjacentStrongDelimiters('展示 \\**原始符号**文本'), '展示 \\**原始符号**文本')
  assert.equal(stabilizeAdjacentStrongDelimiters('尚未完成的 **粗体'), '尚未完成的 **粗体')
})
