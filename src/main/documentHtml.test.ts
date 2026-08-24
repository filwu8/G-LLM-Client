/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createPrintableDocumentHtml, renderMarkdownDocumentBody } from './documentHtml.ts'

test('renders headings, lists, and a real HTML table for PDF printing', () => {
  const body = renderMarkdownDocumentBody(`# 培训通知

- 时间：周五
- 地点：会议室

| 项目 | 内容 |
| --- | --- |
| 培训 | 安全规范 |`)

  assert.match(body, /<h1>培训通知<\/h1>/)
  assert.match(body, /<ul><li>时间：周五<\/li><li>地点：会议室<\/li><\/ul>/)
  assert.match(body, /<table><thead><tr><th>项目<\/th><th>内容<\/th>/)
})

test('escapes untrusted markup before placing it in printable HTML', () => {
  const body = renderMarkdownDocumentBody('<script>alert(1)</script>')
  const html = createPrintableDocumentHtml('标题 <测试>', body)

  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /标题 &lt;测试&gt;/)
  assert.match(html, /Content-Security-Policy/)
})
