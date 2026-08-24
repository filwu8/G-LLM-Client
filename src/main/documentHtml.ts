/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeMarkdownInline(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）')
    .trim()
}

function renderInline(value: string): string {
  return escapeHtml(normalizeMarkdownInline(value))
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\n/g, '<br>')
}

function splitTableRow(line: string): string[] {
  const escapedPipe = '\u0000'
  const normalized = line.trim().replace(/\\\|/g, escapedPipe)
  return normalized
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.replaceAll(escapedPipe, '|').trim())
}

function isTableDivider(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))
}

function renderTable(lines: string[], start: number): { html: string; next: number } | null {
  if (!lines[start]?.includes('|') || !isTableDivider(lines[start + 1] ?? '')) return null
  const header = splitTableRow(lines[start])
  if (header.length < 2 || header.length > 12) return null
  const rows: string[][] = []
  let index = start + 2
  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line || !line.includes('|') || isTableDivider(line)) break
    const cells = splitTableRow(line)
    rows.push(cells.length >= header.length
      ? [...cells.slice(0, header.length - 1), cells.slice(header.length - 1).join(' | ')]
      : [...cells, ...Array.from({ length: header.length - cells.length }, () => '')])
    index += 1
  }
  return {
    html: '<table><thead><tr>'
      + header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')
      + '</tr></thead><tbody>'
      + rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')
      + '</tbody></table>',
    next: index
  }
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index]?.trim() ?? ''
  return !line || Boolean(
    renderTable(lines, index) ||
    /^(?:#{1,6})\s+/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+[.)、]\s*/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*_]{3,}$/.test(line)
  )
}

export function renderMarkdownDocumentBody(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }

    const table = renderTable(lines, index)
    if (table) {
      blocks.push(table.html)
      index = table.next
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = Math.min(3, heading[1].length)
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^[-*_]{3,}$/.test(line)) {
      blocks.push('<hr>')
      index += 1
      continue
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length) {
        const item = lines[index].trim().match(/^[-*+]\s+(.+)$/)
        if (!item) break
        items.push(`<li>${renderInline(item[1])}</li>`)
        index += 1
      }
      blocks.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    if (/^\d+[.)、]\s*/.test(line)) {
      const items: string[] = []
      while (index < lines.length) {
        const item = lines[index].trim().match(/^\d+[.)、]\s*(.+)$/)
        if (!item) break
        items.push(`<li>${renderInline(item[1])}</li>`)
        index += 1
      }
      blocks.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    const quote = line.match(/^>\s?(.+)$/)
    if (quote) {
      blocks.push(`<blockquote>${renderInline(quote[1])}</blockquote>`)
      index += 1
      continue
    }

    const paragraph: string[] = []
    while (index < lines.length && !startsBlock(lines, index)) {
      paragraph.push(lines[index].trim())
      index += 1
    }
    if (paragraph.length === 0) {
      paragraph.push(line)
      index += 1
    }
    blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`)
  }

  return blocks.join('\n')
}

export function createPrintableDocumentHtml(title: string, bodyHtml: string): string {
  const heading = title.trim() ? `<h1 class="document-title">${escapeHtml(title.trim())}</h1>` : ''
  const mainClass = title.trim() ? '' : ' class="promote-first-heading"'
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:">
  <title>${escapeHtml(title.trim() || 'G-LLM Document')}</title>
  <style>
    @page { size: A4; margin: 18mm 17mm 20mm; }
    * { box-sizing: border-box; }
    html { background: #fff; color: #1f2937; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.68;
      overflow-wrap: anywhere;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .document-title { margin: 0 0 20pt; text-align: center; font-size: 22pt; line-height: 1.3; color: #111827; }
    .promote-first-heading > h1:first-child { margin: 0 0 20pt; text-align: center; font-size: 22pt; line-height: 1.3; }
    h1, h2, h3 { color: #111827; break-after: avoid-page; page-break-after: avoid; }
    h1 { margin: 18pt 0 9pt; font-size: 18pt; }
    h2 { margin: 15pt 0 7pt; font-size: 15pt; }
    h3 { margin: 12pt 0 6pt; font-size: 12.5pt; }
    p { margin: 0 0 9pt; }
    ul, ol { margin: 0 0 10pt; padding-left: 2em; }
    li { margin: 2pt 0; }
    blockquote { margin: 10pt 0; padding: 7pt 12pt; color: #4b5563; border-left: 3px solid #9ca3af; background: #f9fafb; }
    code { padding: 1pt 3pt; border-radius: 3px; background: #f3f4f6; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 9.5pt; }
    hr { margin: 14pt 0; border: 0; border-top: 1px solid #d1d5db; }
    table { width: 100%; margin: 10pt 0 14pt; border-collapse: collapse; table-layout: fixed; font-size: 10pt; }
    thead { display: table-header-group; }
    tr { break-inside: avoid-page; page-break-inside: avoid; }
    th, td { padding: 6pt 7pt; border: 1px solid #cbd5e1; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; color: #111827; font-weight: 700; }
    img { display: block; max-width: 100%; height: auto; margin: 8pt auto; break-inside: avoid-page; }
  </style>
</head>
<body>${heading}<main${mainClass}>${bodyHtml}</main></body>
</html>`
}
