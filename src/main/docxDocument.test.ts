/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import JSZip from 'jszip'

import { addDocxHeaderImage, createDocxDocument, inspectDocxBuffer, renderMarkdownToDocx } from './docxDocument.ts'

test('converts a Markdown table into a real editable Word table', async () => {
  const generated = await createDocxDocument('报价', `
| 报价项目 | 主要内容 | 金额（含税） |
| --- | --- | ---: |
| 需求分析与方案设计 | 使用部门访谈、流程确认、权限和管理规则设计 | 12,000元 |
| 通知公告模块 | 发布、编辑、分类、附件、阅读确认和查询统计 | 25,000元 |
`, 'G-LLM')
  const archive = await JSZip.loadAsync(generated.buffer)
  const xml = await archive.file('word/document.xml')?.async('text') ?? ''

  assert.equal(generated.tableCount, 1)
  assert.deepEqual(await inspectDocxBuffer(generated.buffer), { tableCount: 1 })
  assert.equal((xml.match(/<w:tr>/g) ?? []).length, 3)
  assert.equal((xml.match(/<w:tc>/g) ?? []).length, 9)
  assert.match(xml, /<w:tblHeader\/>/)
  assert.match(xml, /<w:shd [^>]*w:fill="F2F4F7"/)
  assert.doesNotMatch(xml, /报价项目\s+\|\s+主要内容/)
})

test('uses exact fixed table geometry and content-aware column widths', () => {
  const rendered = renderMarkdownToDocx(`
| 项目 | 详细说明 | 金额 |
| --- | --- | ---: |
| A | 这是一段明显更长、需要更多横向空间的说明文字 | 12,000元 |
`)
  const table = rendered.tables[0]

  assert.equal(table.columnWidths.reduce((sum, width) => sum + width, 0), 8_786)
  assert.ok(table.columnWidths[1] > table.columnWidths[0])
  assert.match(rendered.xml, /<w:tblW w:w="8786" w:type="dxa"\/>/)
  assert.match(rendered.xml, /<w:tblLayout w:type="fixed"\/>/)
  assert.match(rendered.xml, /<w:jc w:val="right"\/>/)
  for (const width of table.columnWidths) {
    assert.match(rendered.xml, new RegExp(`<w:gridCol w:w="${width}"/>`))
    assert.match(rendered.xml, new RegExp(`<w:tcW w:w="${width}" w:type="dxa"/>`))
  }
})

test('does not mistake an isolated pipe character for a table', () => {
  const rendered = renderMarkdownToDocx('A | B 只是普通文本，没有分隔行。')

  assert.equal(rendered.tables.length, 0)
  assert.doesNotMatch(rendered.xml, /<w:tbl>/)
  assert.match(rendered.xml, /A \| B/)
})

test('escapes cell content and accepts escaped Markdown pipes', () => {
  const rendered = renderMarkdownToDocx(`
| 名称 | 说明 |
| --- | --- |
| A & B | 支持 \\| 字符与 <标签> |
`)

  assert.equal(rendered.tables.length, 1)
  assert.match(rendered.xml, /A &amp; B/)
  assert.match(rendered.xml, /支持 \| 字符与 &lt;标签&gt;/)
})

test('adds a right-aligned image header without replacing the document body', async () => {
  const generated = await createDocxDocument('通知', '正文内容', 'G-LLM')
  const updated = await addDocxHeaderImage(generated.buffer, Buffer.from('fake-png'), {
    extension: 'png',
    widthEmu: 1_500_000,
    heightEmu: 350_000
  })
  const archive = await JSZip.loadAsync(updated)
  const documentXml = await archive.file('word/document.xml')?.async('text') ?? ''
  const headerXml = await archive.file('word/header1.xml')?.async('text') ?? ''
  const relationships = await archive.file('word/_rels/document.xml.rels')?.async('text') ?? ''
  const contentTypes = await archive.file('[Content_Types].xml')?.async('text') ?? ''

  assert.match(documentXml, /<w:headerReference w:type="default" r:id="rId2"\/>/)
  assert.match(documentXml, /正文内容/)
  assert.match(headerXml, /<w:jc w:val="right"\/>/)
  assert.match(headerXml, /<wp:extent cx="1500000" cy="350000"\/>/)
  assert.match(relationships, /relationships\/header" Target="header1\.xml"/)
  assert.match(contentTypes, /Extension="png" ContentType="image\/png"/)
  assert.ok(Object.keys(archive.files).some((name) => /^word\/media\/header-logo-\d+\.png$/.test(name)))
})
