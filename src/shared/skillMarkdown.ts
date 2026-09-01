/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export interface ParsedSkillMarkdown {
  name: string
  description: string
  instructions: string
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function parseSkillMarkdown(markdown: string, fileName: string): ParsedSkillMarkdown {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let body = normalized.trim()
  const metadata: Record<string, string> = {}
  const frontmatter = body.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)

  if (frontmatter) {
    for (const line of frontmatter[1].split('\n')) {
      const match = line.match(/^([\w-]+)\s*:\s*(.+)$/)
      if (match) metadata[match[1].toLowerCase()] = unquote(match[2])
    }
    body = body.slice(frontmatter[0].length).trim()
  }

  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ''
  const fallbackName = fileName.replace(/\.(?:md|markdown)$/i, '').trim()
  const name = metadata.name || metadata.title || heading || fallbackName
  const contentWithoutHeading = heading
    ? body.replace(/^#\s+.+(?:\n+|$)/, '').trim()
    : body
  const firstParagraph = contentWithoutHeading
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/^#+\s+/gm, '').trim())
    .find((paragraph) => paragraph && !paragraph.startsWith('```')) ?? ''

  return {
    name,
    description: metadata.description || firstParagraph.replace(/\s+/g, ' ').slice(0, 240),
    instructions: body
  }
}
