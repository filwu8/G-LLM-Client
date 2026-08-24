/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { BrowserWindow } from 'electron'

import { createPrintableDocumentHtml, renderMarkdownDocumentBody } from './documentHtml'

export interface PdfDocumentInput {
  title?: string
  markdown?: string
  bodyHtml?: string
}

export async function createPdfDocument(input: PdfDocumentInput, signal?: AbortSignal): Promise<Buffer> {
  signal?.throwIfAborted()
  const hasMarkdown = typeof input.markdown === 'string'
  const hasHtml = typeof input.bodyHtml === 'string'
  if (hasMarkdown === hasHtml) throw new Error('PDF 生成必须且只能提供 Markdown 正文或已转换的 HTML 正文')

  const body = hasMarkdown ? renderMarkdownDocumentBody(input.markdown!) : input.bodyHtml!
  if (!body.trim()) throw new Error('PDF 文档正文不能为空')
  const html = createPrintableDocumentHtml(input.title ?? '', body)
  const window = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  try {
    await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
    signal?.throwIfAborted()
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    const output = await window.webContents.printToPDF({
      pageSize: 'A4',
      landscape: false,
      displayHeaderFooter: false,
      printBackground: true,
      preferCSSPageSize: true,
      generateTaggedPDF: true,
      generateDocumentOutline: true
    })
    signal?.throwIfAborted()
    const buffer = Buffer.from(output)
    if (buffer.length < 1_000 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('PDF 渲染完成，但输出结构验证失败')
    }
    return buffer
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}
