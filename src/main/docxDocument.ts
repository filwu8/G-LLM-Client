/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import JSZip from 'jszip'

type TableAlignment = 'left' | 'center' | 'right'

export interface DocxTableMetadata {
  rows: number
  columns: number
  columnWidths: number[]
}

export interface DocxGenerationResult {
  buffer: Buffer
  tableCount: number
  tables: DocxTableMetadata[]
}

export interface DocxHeaderImageOptions {
  extension: 'png' | 'jpg' | 'jpeg'
  widthEmu: number
  heightEmu: number
}

interface ParsedMarkdownTable {
  rows: string[][]
  alignments: Array<TableAlignment | undefined>
  nextLineIndex: number
}

const tableWidthDxa = 8_786
const tableIndentDxa = 120
const tableCellHorizontalMarginDxa = 120
const tableCellVerticalMarginDxa = 80

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function normalizeMarkdownInline(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim()
}

function docxRun(
  text: string,
  options: { bold?: boolean; size?: number; color?: string } = {}
): string {
  const properties = [
    options.bold ? '<w:b/>' : '',
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
    options.color ? `<w:color w:val="${options.color}"/>` : '',
    '<w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/>'
  ].join('')
  const content = text.split('\n').map((part, index) => (
    `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${escapeXml(part)}</w:t>`
  )).join('')
  return `<w:r><w:rPr>${properties}</w:rPr>${content}</w:r>`
}

function docxParagraph(text: string, style?: string): string {
  const paragraphProperties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${paragraphProperties}${text ? docxRun(text) : ''}</w:p>`
}

function splitMarkdownTableRow(line: string): string[] {
  const escapedPipe = '\u0000'
  const normalized = line.trim().replace(/\\\|/g, escapedPipe)
  const withoutOuterPipes = normalized.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
  return withoutOuterPipes
    .split('|')
    .map((cell) => normalizeMarkdownInline(cell.replaceAll(escapedPipe, '|')))
}

function parseAlignmentRow(line: string): Array<TableAlignment | undefined> | null {
  if (!line.includes('|')) return null
  const cells = splitMarkdownTableRow(line)
  if (cells.length < 2 || cells.some((cell) => !/^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))) return null
  return cells.map((cell) => {
    const marker = cell.replace(/\s/g, '')
    if (marker.startsWith(':') && marker.endsWith(':')) return 'center'
    if (marker.endsWith(':')) return 'right'
    if (marker.startsWith(':')) return 'left'
    return undefined
  })
}

function normalizeTableRow(cells: string[], columns: number): string[] {
  if (cells.length === columns) return cells
  if (cells.length < columns) return [...cells, ...Array.from({ length: columns - cells.length }, () => '')]
  return [...cells.slice(0, columns - 1), cells.slice(columns - 1).join(' | ')]
}

function parseMarkdownTableAt(lines: string[], lineIndex: number): ParsedMarkdownTable | null {
  const headerLine = lines[lineIndex]?.trim() ?? ''
  const alignmentLine = lines[lineIndex + 1]?.trim() ?? ''
  if (!headerLine.includes('|')) return null

  const header = splitMarkdownTableRow(headerLine)
  const alignments = parseAlignmentRow(alignmentLine)
  if (!alignments || header.length !== alignments.length || header.length > 12) return null

  const rows = [header]
  let nextLineIndex = lineIndex + 2
  while (nextLineIndex < lines.length) {
    const line = lines[nextLineIndex].trim()
    if (!line || !line.includes('|') || parseAlignmentRow(line)) break
    rows.push(normalizeTableRow(splitMarkdownTableRow(line), header.length))
    nextLineIndex += 1
  }

  return { rows, alignments, nextLineIndex }
}

function displayWidth(value: string): number {
  return Array.from(value).reduce((width, character) => width + (character.codePointAt(0)! > 0xff ? 2 : 1), 0)
}

function distributeColumnWidths(rows: string[][]): number[] {
  const columns = rows[0]?.length ?? 0
  if (!columns) return []
  if (columns === 1) return [tableWidthDxa]

  const weights = Array.from({ length: columns }, (_, column) => Math.max(
    6,
    ...rows.map((row) => Math.min(56, displayWidth(row[column] ?? '')))
  ))
  const minimum = Math.floor(tableWidthDxa / (columns * 2.2))
  const maximumRatio = columns === 2 ? 0.72 : columns === 3 ? 0.56 : 0.45
  const maximum = Math.floor(tableWidthDxa * maximumRatio)
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
  const widths = weights.map((weight) => Math.max(minimum, Math.min(maximum, Math.round(tableWidthDxa * weight / weightTotal))))

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const difference = tableWidthDxa - widths.reduce((sum, width) => sum + width, 0)
    if (!difference) break
    const candidates = widths
      .map((width, index) => ({ width, index, weight: weights[index] }))
      .filter(({ width }) => difference > 0 ? width < maximum : width > minimum)
      .sort((left, right) => right.weight - left.weight)
    if (!candidates.length) break
    const adjustment = Math.trunc(difference / candidates.length) || Math.sign(difference)
    for (const candidate of candidates) {
      widths[candidate.index] = Math.max(minimum, Math.min(maximum, widths[candidate.index] + adjustment))
    }
  }

  widths[widths.length - 1] += tableWidthDxa - widths.reduce((sum, width) => sum + width, 0)
  return widths
}

function looksNumeric(value: string): boolean {
  return /^[¥￥$€£]?\s*[-+]?\d[\d,.\s]*(?:%|元|万元|天|个|人|年|月|日|次|项)?$/.test(value.trim())
}

function resolveColumnAlignments(
  rows: string[][],
  declared: Array<TableAlignment | undefined>
): TableAlignment[] {
  return declared.map((alignment, column) => {
    if (alignment) return alignment
    const bodyValues = rows.slice(1).map((row) => row[column] ?? '').filter(Boolean)
    if (bodyValues.length && bodyValues.filter(looksNumeric).length / bodyValues.length >= 0.6) return 'right'
    if (bodyValues.length && bodyValues.every((value) => displayWidth(value) <= 6)) return 'center'
    return 'left'
  })
}

function tableCellParagraph(text: string, alignment: TableAlignment, header: boolean): string {
  return '<w:p>'
    + `<w:pPr><w:jc w:val="${alignment}"/><w:spacing w:before="0" w:after="0" w:line="280" w:lineRule="auto"/></w:pPr>`
    + docxRun(text, { bold: header, size: 20, color: header ? '1F2937' : '202124' })
    + '</w:p>'
}

function markdownTableToDocx(table: ParsedMarkdownTable): { xml: string; metadata: DocxTableMetadata } {
  const columnWidths = distributeColumnWidths(table.rows)
  const alignments = resolveColumnAlignments(table.rows, table.alignments)
  const grid = columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')
  const rows = table.rows.map((cells, rowIndex) => {
    const header = rowIndex === 0
    const rowProperties = header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''
    const cellXml = cells.map((cell, columnIndex) => (
      '<w:tc><w:tcPr>'
        + `<w:tcW w:w="${columnWidths[columnIndex]}" w:type="dxa"/>`
        + '<w:vAlign w:val="center"/>'
        + (header ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F4F7"/>' : '')
      + '</w:tcPr>'
      + tableCellParagraph(cell, alignments[columnIndex], header)
      + '</w:tc>'
    )).join('')
    return `<w:tr>${rowProperties}${cellXml}</w:tr>`
  }).join('')

  const border = (name: string) => `<w:${name} w:val="single" w:sz="4" w:space="0" w:color="C9D2DC"/>`
  const xml = '<w:tbl><w:tblPr>'
    + `<w:tblW w:w="${tableWidthDxa}" w:type="dxa"/>`
    + `<w:tblInd w:w="${tableIndentDxa}" w:type="dxa"/>`
    + '<w:tblLayout w:type="fixed"/>'
    + `<w:tblBorders>${border('top')}${border('left')}${border('bottom')}${border('right')}${border('insideH')}${border('insideV')}</w:tblBorders>`
    + '<w:tblCellMar>'
      + `<w:top w:w="${tableCellVerticalMarginDxa}" w:type="dxa"/>`
      + `<w:left w:w="${tableCellHorizontalMarginDxa}" w:type="dxa"/>`
      + `<w:bottom w:w="${tableCellVerticalMarginDxa}" w:type="dxa"/>`
      + `<w:right w:w="${tableCellHorizontalMarginDxa}" w:type="dxa"/>`
    + '</w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`

  return { xml, metadata: { rows: table.rows.length, columns: columnWidths.length, columnWidths } }
}

export function renderMarkdownToDocx(content: string): { xml: string; tables: DocxTableMetadata[] } {
  const blocks: string[] = []
  const tables: DocxTableMetadata[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim()
    const table = parseMarkdownTableAt(lines, lineIndex)
    if (table) {
      const rendered = markdownTableToDocx(table)
      blocks.push(rendered.xml)
      tables.push(rendered.metadata)
      lineIndex = table.nextLineIndex - 1
      continue
    }
    if (!line) {
      blocks.push('<w:p/>')
      continue
    }
    if (/^[-*_]{3,}$/.test(line)) continue
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push(docxParagraph(normalizeMarkdownInline(heading[2]), `Heading${Math.min(3, heading[1].length)}`))
      continue
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/)
    if (bullet) {
      blocks.push(docxParagraph(`• ${normalizeMarkdownInline(bullet[1])}`, 'ListParagraph'))
      continue
    }
    const numbered = line.match(/^(\d+)[.)、]\s*(.+)$/)
    if (numbered) {
      blocks.push(docxParagraph(`${numbered[1]}. ${normalizeMarkdownInline(numbered[2])}`, 'ListParagraph'))
      continue
    }
    const quote = line.match(/^>\s+(.+)$/)
    blocks.push(docxParagraph(normalizeMarkdownInline(quote?.[1] ?? line), quote ? 'Quote' : undefined))
  }

  return { xml: blocks.join(''), tables }
}

export async function createDocxDocument(title: string, content: string, author: string): Promise<DocxGenerationResult> {
  const archive = new JSZip()
  const now = new Date().toISOString()
  const rendered = renderMarkdownToDocx(content)
  const body = [title.trim() ? docxParagraph(title.trim(), 'Title') : '', rendered.xml].join('')
  archive.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`)
  archive.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`)
  archive.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  archive.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`)
  archive.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="150"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420" w:hanging="220"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480" w:right="480"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style></w:styles>`)
  archive.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(author || 'G-LLM')}</dc:creator><cp:lastModifiedBy>G-LLM</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
  archive.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>G-LLM</Application><AppVersion>1.0</AppVersion></Properties>`)
  return {
    buffer: await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
    tableCount: rendered.tables.length,
    tables: rendered.tables
  }
}

export async function inspectDocxBuffer(buffer: Buffer): Promise<{ tableCount: number }> {
  const archive = await JSZip.loadAsync(buffer)
  const documentXml = await archive.file('word/document.xml')?.async('text') ?? ''
  return { tableCount: Array.from(documentXml.matchAll(/<w:tbl(?:\s|>)/g)).length }
}

function nextRelationshipId(xml: string): string {
  const ids = Array.from(xml.matchAll(/\bId=["']rId(\d+)["']/gi), (match) => Number(match[1]))
  return `rId${Math.max(0, ...ids) + 1}`
}

function nextHeaderPartName(entries: string[]): string {
  const numbers = entries
    .map((name) => name.match(/^word\/header(\d+)\.xml$/i)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
  return `header${Math.max(0, ...numbers) + 1}.xml`
}

export async function addDocxHeaderImage(
  documentBuffer: Buffer,
  imageBuffer: Buffer,
  options: DocxHeaderImageOptions
): Promise<Buffer> {
  const archive = await JSZip.loadAsync(documentBuffer)
  let documentXml = await archive.file('word/document.xml')?.async('text') ?? ''
  let documentRels = await archive.file('word/_rels/document.xml.rels')?.async('text') ?? ''
  let contentTypes = await archive.file('[Content_Types].xml')?.async('text') ?? ''
  if (!documentXml || !documentRels || !contentTypes) throw new Error('Word 文档缺少必要的 OOXML 结构')
  if (/<w:headerReference\b[^>]*w:type=["']default["']/i.test(documentXml)) {
    throw new Error('文档已经包含默认页眉，当前版本不会覆盖已有页眉内容')
  }

  const extension = options.extension === 'jpeg' ? 'jpg' : options.extension
  const contentType = extension === 'png' ? 'image/png' : 'image/jpeg'
  const relationshipId = nextRelationshipId(documentRels)
  const headerPartName = nextHeaderPartName(Object.keys(archive.files))
  const headerPath = `word/${headerPartName}`
  const mediaName = `header-logo-${Date.now()}.${extension}`
  const widthEmu = Math.max(1, Math.round(options.widthEmu))
  const heightEmu = Math.max(1, Math.round(options.heightEmu))

  if (!/xmlns:r=["']http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships["']/i.test(documentXml)) {
    documentXml = documentXml.replace(
      /<w:document\b/,
      '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    )
  }
  documentXml = documentXml.replace(
    /<w:sectPr([^>]*)>/,
    `<w:sectPr$1><w:headerReference w:type="default" r:id="${relationshipId}"/>`
  )
  if (!documentXml.includes(`r:id="${relationshipId}"`)) throw new Error('Word 文档中没有找到可写入页眉引用的节设置')

  documentRels = documentRels.replace(
    '</Relationships>',
    `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="${headerPartName}"/></Relationships>`
  )
  if (!new RegExp(`<Default\\s+Extension=["']${extension}["']`, 'i').test(contentTypes)) {
    contentTypes = contentTypes.replace(
      '</Types>',
      `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`
    )
  }
  contentTypes = contentTypes.replace(
    '</Types>',
    `<Override PartName="/${headerPath}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`
  )

  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + '<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
    + `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:docPr id="1" name="Header Logo"/>`
    + '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
    + '<pic:nvPicPr><pic:cNvPr id="0" name="Header Logo"/><pic:cNvPicPr/></pic:nvPicPr>'
    + `<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:hdr>'
  const headerRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`

  archive.file('word/document.xml', documentXml)
  archive.file('word/_rels/document.xml.rels', documentRels)
  archive.file('[Content_Types].xml', contentTypes)
  archive.file(headerPath, headerXml)
  archive.file(`word/_rels/${headerPartName}.rels`, headerRels)
  archive.file(`word/media/${mediaName}`, imageBuffer)
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
