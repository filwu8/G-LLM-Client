/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { readFile } from 'node:fs/promises'
import { extname, posix } from 'node:path'
import JSZip from 'jszip'
import mammoth from 'mammoth'

function decodeXmlText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function xmlAttribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return tag.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, 'i'))?.[1]
}

function xmlText(xml: string): string {
  return Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi))
    .map((match) => decodeXmlText(match[1]))
    .join('')
}

async function readSpreadsheet(path: string): Promise<string> {
  let archive: JSZip
  try {
    archive = await JSZip.loadAsync(await readFile(path))
  } catch {
    throw new Error('无法读取此 XLSX 工作簿；文件可能损坏或不是有效的 .xlsx 文件')
  }
  const workbook = await archive.file('xl/workbook.xml')?.async('text')
  if (!workbook) throw new Error('无法读取 XLSX 工作簿结构；当前仅支持标准 .xlsx，不支持旧版 .xls')

  const sharedStringsXml = await archive.file('xl/sharedStrings.xml')?.async('text') ?? ''
  const sharedStrings = Array.from(sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi))
    .map((match) => xmlText(match[1]))

  const relationshipsXml = await archive.file('xl/_rels/workbook.xml.rels')?.async('text') ?? ''
  const relationships = new Map<string, string>()
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*?)\/?\s*>/gi)) {
    const id = xmlAttribute(match[1], 'Id')
    const target = xmlAttribute(match[1], 'Target')
    if (id && target) {
      const normalized = decodeXmlText(target).replace(/^\/+/, '')
      relationships.set(id, normalized.startsWith('xl/') ? normalized : posix.join('xl', normalized))
    }
  }

  const sheets = Array.from(workbook.matchAll(/<sheet\b([^>]*?)\/?\s*>/gi)).slice(0, 200)
  if (sheets.length === 0) throw new Error('XLSX 工作簿中没有可读取的工作表')
  const output: string[] = []
  let totalCharacters = 0
  const maxCharacters = 2_000_000

  for (let index = 0; index < sheets.length; index += 1) {
    const attributes = sheets[index][1]
    const name = decodeXmlText(xmlAttribute(attributes, 'name') ?? `工作表 ${index + 1}`)
    const relationshipId = xmlAttribute(attributes, 'r:id')
    const sheetPath = (relationshipId && relationships.get(relationshipId)) ?? `xl/worksheets/sheet${index + 1}.xml`
    const sheetXml = await archive.file(sheetPath)?.async('text')
    if (!sheetXml) {
      output.push(`[工作表：${name}]\n[无法读取工作表数据]`)
      continue
    }

    const rows: string[] = [`[工作表：${name}]`]
    for (const [rowIndex, rowMatch] of Array.from(sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)).entries()) {
      const rowNumber = xmlAttribute(rowMatch[1], 'r') ?? String(rowIndex + 1)
      const cells: string[] = []
      for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
        const reference = xmlAttribute(cellMatch[1], 'r') ?? `row ${rowNumber}`
        const cellType = xmlAttribute(cellMatch[1], 't')
        const body = cellMatch[2] ?? ''
        const value = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i)?.[1]
        const formula = body.match(/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/i)?.[1]
        let displayValue = value === undefined ? '' : decodeXmlText(value)
        if (cellType === 's' && value !== undefined) displayValue = sharedStrings[Number(value)] ?? `[共享字符串索引无效：${value}]`
        else if (cellType === 'inlineStr') displayValue = xmlText(body)
        else if (cellType === 'b') displayValue = value === '1' ? 'TRUE' : 'FALSE'
        if (formula && !displayValue) displayValue = `=${decodeXmlText(formula)}`
        else if (formula) displayValue = `${displayValue}（公式：=${decodeXmlText(formula)}）`
        if (displayValue.trim()) cells.push(`${reference}: ${displayValue.trim()}`)
      }
      if (cells.length > 0) rows.push(cells.join(' | '))
      const rowText = rows[rows.length - 1]
      totalCharacters += rowText.length + 1
      if (totalCharacters >= maxCharacters) {
        rows.push('[工作簿内容达到读取上限，后续内容未读取]')
        break
      }
    }
    output.push(rows.join('\n'))
    if (totalCharacters >= maxCharacters) break
  }
  return output.join('\n\n')
}

export async function extractWorkspaceDocumentText(path: string): Promise<string> {
  const extension = extname(path).toLocaleLowerCase()
  if (extension === '.xls') throw new Error('旧版 .xls 文件当前不支持；请另存为 .xlsx 后再读取')
  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ path })
    return result.value
  }
  if (extension === '.pptx') {
    const archive = await JSZip.loadAsync(await readFile(path))
    const slides = Object.keys(archive.files)
      .map((name) => ({ name, match: name.match(/^ppt\/slides\/slide(\d+)\.xml$/i) }))
      .filter((item): item is { name: string; match: RegExpMatchArray } => Boolean(item.match))
      .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))
    const pages: string[] = []
    for (const slide of slides.slice(0, 300)) {
      const xml = await archive.file(slide.name)?.async('text') ?? ''
      const lines = Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi))
        .map((match) => decodeXmlText(match[1]).trim())
        .filter(Boolean)
      pages.push(`[第 ${Number(slide.match[1])} 页]\n${lines.join('\n') || '[无可提取文字]'}`)
    }
    return pages.join('\n\n')
  }
  if (extension === '.xlsx') return readSpreadsheet(path)
  if (extension === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: await readFile(path) })
    try {
      const text = (await parser.getText()).text
      const searchableText = text.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, '').trim()
      if (!searchableText) {
        throw new Error('PDF 未提取到可搜索文本，可能是扫描件或图片型 PDF；当前客户端没有内置 OCR。请提供可搜索 PDF 或页面图片，再继续处理。')
      }
      return text
    } finally {
      await parser.destroy()
    }
  }
  throw new Error('read_document 当前支持 .pdf、.docx、.pptx 和 .xlsx；扫描件 PDF 需要先进行 OCR')
}
