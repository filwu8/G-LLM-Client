/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { isValidElement, type ReactNode, useEffect, useId, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const MARKDOWN_DOCUMENT_FENCE_LANGUAGES = new Set(['markdown', 'md', 'mdx', 'gfm', 'commonmark'])
const PLAIN_TEXT_FENCE_LANGUAGES = new Set(['text', 'txt', 'plain', 'plaintext'])

export function normalizeMarkdownForDisplay(input: string): string {
  if (!input) return input

  const normalizedInput = unwrapMarkdownDocumentFence(input.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
  const lines = normalizedInput.split('\n')
  const expanded: string[] = []
  let inFence = false
  let fenceMarker = ''

  for (const line of lines) {
    for (const expandedLine of expandSingleLineFence(line)) {
      const trimmed = expandedLine.trim()
      const marker = fenceLineMarker(trimmed)
      if (marker) {
        expanded.push(expandedLine)
        if (!inFence) {
          inFence = true
          fenceMarker = marker
        } else if (marker === fenceMarker) {
          inFence = false
          fenceMarker = ''
        }
        continue
      }

      if (inFence) {
        expanded.push(expandedLine)
        continue
      }

      expanded.push(...splitFlattenedMarkdownTableLine(expandedLine))
    }
  }

  if (inFence && fenceMarker) {
    expanded.push(fenceMarker)
  }

  return normalizeMarkdownTableSeparators(expanded).join('\n')
}

function unwrapMarkdownDocumentFence(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return input

  const lines = trimmed.split('\n')
  const opening = lines[0]?.trim() ?? ''
  const marker = fenceLineMarker(opening)
  if (!marker) return input

  const info = fenceLineInfo(opening, marker)
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === marker)
  if (closingIndex > 0 && closingIndex !== lines.length - 1) return input

  const bodyLines = closingIndex === lines.length - 1 ? lines.slice(1, -1) : lines.slice(1)
  const body = bodyLines.join('\n').trim()
  if (!body) return input

  if (MARKDOWN_DOCUMENT_FENCE_LANGUAGES.has(info)) return body
  if ((info === '' || PLAIN_TEXT_FENCE_LANGUAGES.has(info)) && looksLikeRenderableMarkdown(body)) return body

  return input
}

function fenceLineInfo(trimmed: string, marker: string): string {
  return (trimmed.slice(marker.length).trim().split(/\s+/)[0] ?? '').toLowerCase()
}

function looksLikeRenderableMarkdown(value: string): boolean {
  const lines = value.split('\n')
  if (lines.some((line, index) => index > 0 && isMarkdownTableSeparatorRow(line) && isMarkdownTableRow(lines[index - 1] ?? ''))) {
    return true
  }

  return /(^|\n)\s{0,3}(#{1,6}\s+\S|[-*+]\s+\S|\d{1,3}\.\s+\S|>\s+\S)/.test(value) || /(\*\*|__)[^*_]+(\*\*|__)/.test(value)
}

function expandSingleLineFence(line: string): string[] {
  const trimmed = line.trim()
  const indent = line.match(/^\s*/)?.[0] ?? ''

  for (const marker of ['```', '~~~']) {
    if (!trimmed.startsWith(marker) || !trimmed.endsWith(marker)) continue

    const body = trimmed.slice(marker.length, -marker.length).trim()
    if (!body) return [line]

    const fields = body.split(/\s+/)
    const info = fields[0] ?? ''
    if (fields.length < 2 || !isFenceInfo(info)) return [line]

    const content = body.slice(info.length).trim()
    if (!content) return [line]

    return [`${indent}${marker}${info}`, `${indent}${content}`, `${indent}${marker}`]
  }

  return [line]
}

function isFenceInfo(value: string): boolean {
  return /^[A-Za-z0-9_.+#-]+$/.test(value)
}

function fenceLineMarker(trimmed: string): string {
  if (trimmed.startsWith('```')) return '```'
  if (trimmed.startsWith('~~~')) return '~~~'
  return ''
}

function splitFlattenedMarkdownTableLine(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|') || (trimmed.match(/\|/g)?.length ?? 0) < 6) return [line]

  const rows: string[] = []
  let start = 0
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== '|') continue

    let j = i + 1
    while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j += 1
    if (j >= line.length || line[j] !== '|') continue

    const row = line.slice(start, i + 1).trim()
    if (row) rows.push(row)
    start = j
    i = j - 1
  }

  const tail = line.slice(start).trim()
  if (tail) rows.push(tail)
  if (rows.length < 2) return [line]

  const separatorIndex = rows.findIndex(isMarkdownTableSeparatorRow)
  if (separatorIndex <= 0) return [line]

  const headerCellCount = countMarkdownTableCells(rows[separatorIndex - 1] ?? '')
  if (headerCellCount < 2) return [line]

  if (rows.some((row, index) => index !== separatorIndex && countMarkdownTableCells(row) < 2)) {
    return [line]
  }

  return rows.every(isMarkdownTableRow) ? rows : [line]
}

function normalizeMarkdownTableSeparators(lines: string[]): string[] {
  const out = [...lines]
  let inFence = false
  let fenceMarker = ''

  for (let i = 0; i < out.length; i += 1) {
    const marker = fenceLineMarker(out[i]?.trim() ?? '')
    if (marker) {
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }

    const line = out[i] ?? ''
    const previous = out[i - 1] ?? ''
    if (inFence || i === 0 || !isMarkdownTableSeparatorRow(line) || !isMarkdownTableRow(previous)) continue

    const headerCellCount = countMarkdownTableCells(previous)
    if (headerCellCount < 2 || countMarkdownTableCells(line) === headerCellCount) continue

    out[i] = `${line.match(/^[ \t]*/)?.[0] ?? ''}${markdownTableSeparator(headerCellCount)}`
  }

  return out
}

function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && (trimmed.match(/\|/g)?.length ?? 0) >= 2
}

function isMarkdownTableSeparatorRow(line: string): boolean {
  const cells = markdownTableCells(line)
  if (cells.length === 0) return false

  return cells.every((cell) => {
    let trimmed = cell.trim()
    if (trimmed.startsWith(':')) trimmed = trimmed.slice(1)
    if (trimmed.endsWith(':')) trimmed = trimmed.slice(0, -1)
    return trimmed.length >= 3 && /^-+$/.test(trimmed)
  })
}

function countMarkdownTableCells(line: string): number {
  return markdownTableCells(line).length
}

function markdownTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed ? trimmed.split('|') : []
}

function markdownTableSeparator(columns: number): string {
  return `|${Array.from({ length: columns }, () => '---').join('|')}|`
}

function hashText(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function getThemeColor(variable: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return value ? `hsl(${value})` : fallback
}

function MermaidDiagram({ diagram }: { diagram: string }) {
  const reactId = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const [themeRevision, setThemeRevision] = useState(0)
  const renderId = useMemo(
    () => `gllm-mermaid-${reactId}-${hashText(diagram)}-${themeRevision}`,
    [diagram, reactId, themeRevision]
  )
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const handleThemeChange = () => setThemeRevision((revision) => revision + 1)
    window.addEventListener('gllm-theme-changed', handleThemeChange)
    return () => window.removeEventListener('gllm-theme-changed', handleThemeChange)
  }, [])

  useEffect(() => {
    let cancelled = false
    setSvg('')
    setError('')

    if (!diagram.trim()) return undefined

    void import('mermaid')
      .then(({ default: mermaid }) => {
        const isDark = document.documentElement.dataset.theme !== 'light'
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          darkMode: isDark,
          themeVariables: {
            background: getThemeColor('--background', '#f8fafc'),
            primaryColor: getThemeColor('--card', '#ffffff'),
            primaryTextColor: getThemeColor('--foreground', '#0f172a'),
            primaryBorderColor: getThemeColor('--border', '#e2e8f0'),
            secondaryColor: getThemeColor('--secondary', '#f1f5f9'),
            tertiaryColor: getThemeColor('--muted', '#f1f5f9'),
            lineColor: getThemeColor('--muted-foreground', '#64748b'),
            noteBkgColor: getThemeColor('--accent', '#f1f5f9'),
            noteTextColor: getThemeColor('--accent-foreground', '#0f172a'),
            fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif'
          }
        })
        return mermaid.render(renderId, diagram)
      })
      .then(({ svg }) => {
        if (!cancelled) setSvg(svg)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      cancelled = true
    }
  }, [diagram, renderId])

  if (error) {
    return (
      <div className="mermaid-diagram-shell failed">
        <pre>
          <code>{diagram}</code>
        </pre>
        <small>{error}</small>
      </div>
    )
  }

  if (!svg) {
    return <div className="mermaid-diagram-shell loading" />
  }

  return (
    <div className="mermaid-diagram-shell">
      <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

function getSingleChild(children: ReactNode): ReactNode {
  return Array.isArray(children) ? children.find((child) => child !== '\n') : children
}

function isMermaidShell(node: ReactNode): boolean {
  return Boolean(isValidElement<{ className?: string }>(node) && node.props.className?.split(/\s+/).includes('mermaid-diagram-shell'))
}

function markdownUrlTransform(value: string, key: string): string {
  const url = value.trim()
  if (key === 'src' && /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(url)) {
    return url.replace(/\s+/g, '')
  }
  if (key === 'src' && /^gllm-data:\/\//i.test(url)) {
    return url
  }
  if (/^(https?:|mailto:|tel:)/i.test(url) || /^[#/]/.test(url) || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) {
    return url
  }
  return ''
}

export function MarkdownMessage({ content }: { content: string }) {
  const normalizedContent = useMemo(() => normalizeMarkdownForDisplay(content), [content])

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={markdownUrlTransform}
      components={{
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
        pre: ({ children, ...props }) => (isMermaidShell(getSingleChild(children)) ? <>{children}</> : <pre {...props}>{children}</pre>),
        code: ({ className, children, ...props }) => {
          const language = /language-([A-Za-z0-9_-]+)/.exec(className ?? '')?.[1]?.toLowerCase()
          const value = String(children ?? '').replace(/\n$/, '')
          if (language === 'mermaid') return <MermaidDiagram diagram={value} />
          return (
            <code className={className} {...props}>
              {children}
            </code>
          )
        }
      }}
    >
      {normalizedContent}
    </ReactMarkdown>
  )
}
