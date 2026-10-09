/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { getSkillInstallIntent, type SkillInstallIntent } from '../shared/skillInstallation'
import { parseSkillMarkdown } from '../shared/skillMarkdown'
import type { Conversation, PreparedAttachment, SkillConfig } from '../shared/types'

const maxBytes = 1024 * 1024
export class SkillInstallationError extends Error {
  readonly code: string
  constructor(code: string, cause?: unknown) {
    super(code, { cause })
    this.name = 'SkillInstallationError'
    this.code = code
  }
}

export interface SkillInstallationSource {
  name: string
  description: string
  instructions: string
  sourceLocator?: string
  existingSkillId?: string
  hasUnbundledResources: boolean
}

export function getConversationSkillInstallIntent(conversation: Conversation): SkillInstallIntent {
  const user = conversation.messages?.at(-2)
  if (user?.role !== 'user' || conversation.messages.at(-1)?.role !== 'assistant' || typeof user.content !== 'string') {
    throw new SkillInstallationError('invalidRequest')
  }
  const intent = getSkillInstallIntent(user.content)
  if (!intent) throw new SkillInstallationError('invalidRequest')
  return intent
}

function parseDocument(text: string, fileName: string, sourceLocator: string): SkillInstallationSource {
  if (!text.trim() || /\u0000|<!doctype\s+html|<html[\s>]/i.test(text)) throw new SkillInstallationError('invalidDocument')
  const parsed = parseSkillMarkdown(text, fileName)
  if (!parsed.name.trim() || !parsed.instructions.trim()) throw new SkillInstallationError('invalidDocument')
  if (parsed.name.length > 100 || parsed.instructions.length > 50_000) throw new SkillInstallationError('rulesTooLong')
  return { ...parsed, sourceLocator, hasUnbundledResources: /\b(?:scripts|references|assets)\/|\]\((?!https?:|#)[^)]+\)/i.test(parsed.instructions) }
}

function normalizeDocumentUrl(input: string): URL {
  let url: URL
  try { url = new URL(input) } catch { throw new SkillInstallationError('invalidUrl') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new SkillInstallationError('invalidUrl')
  if (url.hostname === 'github.com') {
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
    if (match) url = new URL(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}`)
  }
  if (!/\.(?:md|markdown)$/i.test(url.pathname)) throw new SkillInstallationError('markdownOnly')
  return url
}

async function downloadDocument(input: string, fetcher: typeof fetch, signal?: AbortSignal): Promise<SkillInstallationSource> {
  let url = normalizeDocumentUrl(input)
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000)
  try {
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      requestSignal.throwIfAborted()
      const response = await fetcher(url.toString(), { redirect: 'manual', signal: requestSignal, headers: { Accept: 'text/markdown, text/plain' } })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location || redirects === 4) throw new SkillInstallationError('downloadFailed')
        url = normalizeDocumentUrl(new URL(location, url).toString())
        continue
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new SkillInstallationError('downloadFailed')
      }
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body.cancel()
        throw new SkillInstallationError('fileTooLarge')
      }
      if (/text\/html/i.test(response.headers.get('content-type') ?? '')) {
        await response.body.cancel()
        throw new SkillInstallationError('invalidDocument')
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) {
          requestSignal.throwIfAborted()
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > maxBytes) throw new SkillInstallationError('fileTooLarge')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel().catch(() => undefined) }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      return parseDocument(text, decodeURIComponent(basename(url.pathname)), `${url.origin}${url.pathname}`)
    }
  } catch (error) {
    if (signal?.aborted) throw new SkillInstallationError('cancelled')
    if (error instanceof SkillInstallationError) throw error
    throw new SkillInstallationError('downloadFailed', error)
  }
  throw new SkillInstallationError('downloadFailed')
}

async function readAttachment(attachment: PreparedAttachment, pathForId: (id: string) => string | undefined): Promise<SkillInstallationSource> {
  const path = pathForId(attachment.id)
  let text: string
  if (path) {
    if (!/\.(?:md|markdown)$/i.test(extname(path))) throw new SkillInstallationError('markdownOnly')
    const info = await stat(path)
    if (!info.isFile() || info.size > maxBytes) throw new SkillInstallationError('fileTooLarge')
    const bytes = await readFile(path)
    if (bytes.byteLength > maxBytes) throw new SkillInstallationError('fileTooLarge')
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new SkillInstallationError('invalidDocument') }
  } else {
    if (attachment.size > maxBytes) throw new SkillInstallationError('fileTooLarge')
    text = attachment.text ?? ''
    if (text.length >= 40_000 && attachment.size > Buffer.byteLength(text)) throw new SkillInstallationError('reupload')
  }
  return parseDocument(text, attachment.name, attachment.name)
}

export async function resolveSkillInstallationSource(
  conversation: Conversation,
  skills: SkillConfig[],
  options: { fetcher: typeof fetch; pathForAttachment: (id: string) => string | undefined; signal?: AbortSignal }
): Promise<SkillInstallationSource> {
  const intent = getConversationSkillInstallIntent(conversation)
  const user = conversation.messages.at(-2)!
  if (intent.urls.length > 1) throw new SkillInstallationError('multipleSources')
  if (intent.urls.length === 1) return downloadDocument(intent.urls[0], options.fetcher, options.signal)
  if (intent.inlineMarkdown) return parseDocument(intent.inlineMarkdown, 'Skill.md', 'conversation')
  const markdownFiles = (user.attachments ?? []).filter((file) => /\.(?:md|markdown)$/i.test(file.name))
  const matches = skills.filter((skill) => skill.name.toLocaleLowerCase() === intent.referenceName.toLocaleLowerCase())
  if (!markdownFiles.length && matches.length === 1) {
    const skill = matches[0]
    if (!skill.instructions.trim()) throw new SkillInstallationError('invalidDocument')
    return { ...skill, existingSkillId: skill.id, hasUnbundledResources: false }
  }
  const historicalFiles = [...conversation.messages.slice(0, -2)].reverse()
    .find((message) => message.role === 'user' && message.attachments?.some((file) => /\.(?:md|markdown)$/i.test(file.name)))
    ?.attachments?.filter((file) => /\.(?:md|markdown)$/i.test(file.name)) ?? []
  const canUseHistory = !intent.referenceName || /上传|附件|刚才|这(?:个|份)|uploaded|attached|previous/i.test(user.content)
    || historicalFiles.some((file) => user.content.includes(file.name))
  const candidates = markdownFiles.length ? markdownFiles : canUseHistory ? historicalFiles : []
  const named = candidates.filter((file) => user.content.includes(file.name))
  const chosen = named.length === 1 ? named : candidates
  if (chosen.length > 1 || matches.length > 1) throw new SkillInstallationError('multipleSources')
  if (chosen.length === 1) return readAttachment(chosen[0], options.pathForAttachment)
  throw new SkillInstallationError('needSource')
}
