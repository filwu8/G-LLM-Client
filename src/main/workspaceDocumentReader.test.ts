/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import { extractWorkspaceDocumentText } from './workspaceDocumentReader.ts'

test('reads XLSX sheet names, shared strings, inline strings, values and formulas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gllm-xlsx-reader-'))
  const path = join(directory, 'application.xlsx')
  const workbook = new JSZip()
  workbook.file('xl/workbook.xml', '<workbook xmlns:r="urn:r"><sheets><sheet name="申报表" sheetId="1" r:id="rId1"/></sheets></workbook>')
  workbook.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
  workbook.file('xl/sharedStrings.xml', '<sst><si><t>项目名称</t></si><si><r><t>产品</t></r><r><t> &amp; 服务</t></r></si></sst>')
  workbook.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>填报内容</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>')
  try {
    await writeFile(path, await workbook.generateAsync({ type: 'nodebuffer' }))
    const text = await extractWorkspaceDocumentText(path)
    assert.match(text, /\[工作表：申报表\]/)
    assert.match(text, /A1: 项目名称/)
    assert.match(text, /B1: 填报内容/)
    assert.match(text, /A2: 产品 & 服务/)
    assert.match(text, /B2: 3（公式：=1\+2）/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('reports image-only PDFs as unreadable without OCR instead of returning an empty success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gllm-scanned-pdf-'))
  const path = join(directory, 'scan.pdf')
  try {
    const pdf = await PDFDocument.create()
    const page = pdf.addPage()
    page.drawImage(await pdf.embedPng(createCanvas(12, 12).toBuffer('image/png')))
    await writeFile(path, await pdf.save())
    await assert.rejects(extractWorkspaceDocumentText(path), /未提取到可搜索文本.*没有内置 OCR/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('rejects legacy XLS with an explicit supported-format message', async () => {
  await assert.rejects(extractWorkspaceDocumentText('legacy.xls'), /旧版 \.xls.*另存为 \.xlsx/)
})
