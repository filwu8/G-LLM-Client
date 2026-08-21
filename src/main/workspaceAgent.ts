/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { app } from 'electron'
import JSZip from 'jszip'
import mammoth from 'mammoth'

import type {
  ChatMessage,
  WorkspaceAgentProgress,
  WorkspaceAgentRequest,
  WorkspaceAgentResult,
  WorkspaceToolActivity
} from '../shared/types'
import { supportsReasoningEffort } from '../shared/featureFlags'
import { compressImageToTarget, renderPdfToTarget } from './localFileTasks'
import { getConversationProjectMemoryContext, prepareConversationContext } from './gllmClient'
import { mainT } from './i18n'
import {
  readWorkspaceModelEventStream,
  type WorkspaceModelMessage as ModelMessage,
  type WorkspaceToolCall as ToolCall
} from './workspaceModelStream'

type AgentMessageContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: AgentMessageContent | null
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

interface ModelResponse {
  response: Response
  message?: ModelMessage
}

export interface WorkspaceToolApprovalRequest {
  tool: string
  purpose: string
  workspaceName: string
  canWrite: boolean
  isScript: boolean
}

type WorkspaceToolApprovalHandler = (request: WorkspaceToolApprovalRequest) => Promise<boolean>

const workspaceRunLocks = new Map<string, string>()

const toolDefinitions = [
  { type: 'function', function: { name: 'list_directory', description: '列出工作区内目录内容', parameters: { type: 'object', properties: { path: { type: 'string', description: '相对工作区路径，默认 .' } } } } },
  { type: 'function', function: { name: 'inspect_file', description: '检查文件或目录的类型、大小和修改时间', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'read_file', description: '读取工作区内 UTF-8 文本文件', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'read_document', description: '分段提取工作区内 PDF、Word（.docx）或 PowerPoint（.pptx）的正文文本，适合阅读和分析文档；较长文档可根据返回的范围继续读取。', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, offset: { type: 'number', description: '从第几个字符开始，默认 0' }, maxCharacters: { type: 'number', description: '本次最多读取字符数，默认 60000，最大 120000' } } } } },
  { type: 'function', function: { name: 'create_docx', description: '在工作区生成真正的 Microsoft Word .docx 文档。content 支持普通文本和基础 Markdown 标题、列表、表格文本；生成后工具会重新读取并验证正文。', parameters: { type: 'object', required: ['output', 'content'], properties: { output: { type: 'string', description: '相对工作区的 .docx 输出路径' }, title: { type: 'string', description: '可选文档标题' }, content: { type: 'string', description: '要写入 Word 的完整正文，支持基础 Markdown' }, author: { type: 'string', description: '可选作者' } } } } },
  { type: 'function', function: { name: 'write_file', description: '在工作区内创建或完整写入 UTF-8 文本文件', parameters: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } } },
  { type: 'function', function: { name: 'replace_text', description: '精确替换文本文件中的一段内容；适合修改代码并避免重写整文件', parameters: { type: 'object', required: ['path', 'oldText', 'newText'], properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, replaceAll: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'create_directory', description: '在工作区内创建目录', parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'move_file', description: '移动或重命名工作区内文件，不覆盖已有目标', parameters: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' } } } } },
  { type: 'function', function: { name: 'search_files', description: '按文件名和可选文本内容搜索工作区', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, path: { type: 'string' }, includeContent: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'compress_image', description: '把工作区内图片压缩到指定字节数，输出为 JPEG', parameters: { type: 'object', required: ['source', 'output', 'targetBytes'], properties: { source: { type: 'string' }, output: { type: 'string' }, targetBytes: { type: 'number' } } } } },
  { type: 'function', function: { name: 'compress_pdf', description: '在不超过目标大小的前提下搜索分辨率和 JPEG 质量，选择画质最高的 PDF；会丢失文本搜索、表单、链接和签名。minimumBytes 只是接近上限的画质偏好，绝不能通过填充无意义字节满足。', parameters: { type: 'object', required: ['source', 'output', 'targetBytes'], properties: { source: { type: 'string' }, output: { type: 'string' }, targetBytes: { type: 'number' }, minimumBytes: { type: 'number', description: '可选的期望最小大小，仅用于从真实压缩候选中择优' } } } } },
  { type: 'function', function: { name: 'run_javascript', description: '在隔离执行器中运行临时 JavaScript，适合没有专用工具的批量文件、文本、JSON、CSV 和代码处理任务。代码中可使用异步 workspace API：list(path,{recursive,limit})、stat(path)、readText(path)、writeText(path,content)、readBase64(path)、writeBase64(path,base64)、mkdir(path)、copy(from,to)、move(from,to)，以及 console.log。不能使用 import、require、process、网络、系统命令或工作区外路径。最后可 return 简短结果。', parameters: { type: 'object', required: ['purpose', 'code'], properties: { purpose: { type: 'string', description: '本次脚本要完成的工作' }, code: { type: 'string', description: '直接执行的 JavaScript 代码；顶层可使用 await 和 return' } } } } },
  { type: 'function', function: { name: 'generate_image', description: '使用当前供应商的图片生成接口生成图片并保存到工作区', parameters: { type: 'object', required: ['prompt', 'output'], properties: { prompt: { type: 'string' }, output: { type: 'string', description: '建议使用 .png 文件名' } } } } }
]

function providerUrl(request: WorkspaceAgentRequest): string {
  const path = request.provider.chatCompletionsPath ?? '/chat/completions'
  return `${request.provider.apiBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

const retryableModelStatuses = new Set([408, 425, 429, 500, 502, 503, 504])

interface ModelRetryInfo {
  attempt: number
  maxAttempts: number
  status?: number
  reason: string
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

async function fetchModelResponse(
  request: WorkspaceAgentRequest,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Response> {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => {
    timeoutController.abort(new DOMException('Model response headers timed out', 'TimeoutError'))
  }, 120_000)
  const fetchSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal

  try {
    return await fetch(providerUrl(request), {
      method: 'POST',
      headers: {
        ...(request.provider.apiKey ? { Authorization: `Bearer ${request.provider.apiKey}` } : {}),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: fetchSignal
    })
  } finally {
    clearTimeout(timeout)
  }
}

function streamTimeoutError(): DOMException {
  return new DOMException('Model stream was idle for 120 seconds', 'TimeoutError')
}

async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal?.throwIfAborted()
  return await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      void reader.cancel().catch(() => undefined)
      rejectPromise(streamTimeoutError())
    }, 120_000)
    const handleAbort = () => {
      clearTimeout(timeout)
      void reader.cancel().catch(() => undefined)
      rejectPromise(signal?.reason)
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
    void reader.read().then(resolvePromise, rejectPromise).finally(() => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
    })
  })
}

async function readModelMessage(response: Response, signal?: AbortSignal): Promise<ModelMessage | undefined> {
  const contentType = response.headers.get('content-type')?.toLocaleLowerCase() ?? ''
  if (!contentType.includes('text/event-stream')) {
    if (!response.body) throw new Error('模型服务未返回响应正文')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let body = ''
    while (true) {
      const { done, value } = await readStreamChunk(reader, signal)
      if (done) {
        body += decoder.decode()
        break
      }
      body += decoder.decode(value, { stream: true })
    }
    const payload = JSON.parse(body) as { choices?: Array<{ message?: ModelMessage }> }
    return payload.choices?.[0]?.message
  }
  if (!response.body) throw new Error('模型服务未返回响应正文')
  return await readWorkspaceModelEventStream(
    response.body,
    (reader) => readStreamChunk(reader, signal)
  )
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
  signal.throwIfAborted()
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolvePromise()
    }, milliseconds)
    const handleAbort = () => {
      clearTimeout(timer)
      rejectPromise(signal.reason)
    }
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function friendlyModelStatus(status: number, request: WorkspaceAgentRequest): string {
  if ([429, 502, 503, 504].includes(status)) {
    return mainT(`main.workspace.status${status}`, request.settings.language)
  }
  if (status >= 500) return mainT('main.workspace.status5xx', request.settings.language, { status })
  return mainT('main.workspace.statusHttp', request.settings.language, { status })
}

async function safeResponseError(response: Response, request: WorkspaceAgentRequest): Promise<string> {
  const fallback = friendlyModelStatus(response.status, request)
  try {
    const contentType = response.headers.get('content-type')?.toLocaleLowerCase() ?? ''
    const body = (await response.text()).trim()
    if (!body || contentType.includes('text/html') || /<!doctype\s+html|<html[\s>]/i.test(body)) return fallback
    if (contentType.includes('json')) {
      const payload = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown }
      const message = typeof payload.error === 'string'
        ? payload.error
        : typeof payload.error?.message === 'string'
          ? payload.error.message
          : typeof payload.message === 'string'
            ? payload.message
            : ''
      return message.trim() ? `${fallback}：${message.trim().slice(0, 240)}` : fallback
    }
    const plain = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    return plain ? `${fallback}：${plain}` : fallback
  } catch {
    return fallback
  }
}

async function fetchModelWithRetry(
  request: WorkspaceAgentRequest,
  body: Record<string, unknown>,
  onRetry: (info: ModelRetryInfo) => void,
  maxAttempts = 3,
  signal?: AbortSignal
): Promise<ModelResponse> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    signal?.throwIfAborted()
    try {
      const response = await fetchModelResponse(request, body, signal)
      if (response.ok) return { response, message: await readModelMessage(response, signal) }
      if (!retryableModelStatuses.has(response.status) || attempt === maxAttempts) return { response }

      onRetry({
        attempt,
        maxAttempts,
        status: response.status,
        reason: friendlyModelStatus(response.status, request)
      })
      await response.arrayBuffer().catch(() => undefined)
    } catch (error) {
      signal?.throwIfAborted()
      const reason = error instanceof Error && error.name === 'TimeoutError'
        ? '模型服务在 120 秒内没有响应'
        : error instanceof Error
          ? `网络连接异常：${error.message}`
          : '网络连接异常'
      if (attempt === maxAttempts) throw new Error(`模型请求阶段失败：${reason}`)
      onRetry({ attempt, maxAttempts, reason })
    }
    await wait([800, 1_800, 3_000][attempt - 1] ?? 3_000, signal)
  }
  throw new Error('模型请求阶段失败：已达到自动重试上限')
}

function ensureRelativePath(input: unknown): string {
  const value = String(input ?? '.').trim() || '.'
  if (isAbsolute(value)) throw new Error('工具只能使用工作区相对路径')
  return value
}

function isInside(child: string, root: string): boolean {
  const diff = relative(root, child)
  return diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))
}

async function resolveExisting(root: string, input: unknown): Promise<string> {
  const rootReal = await realpath(root)
  const target = await realpath(resolve(rootReal, ensureRelativePath(input)))
  if (!isInside(target, rootReal)) throw new Error('路径超出当前会话工作区')
  return target
}

export async function resolveWorkspaceItem(root: string, relativePath: string): Promise<string> {
  return resolveExisting(root, relativePath)
}

async function resolveWritable(root: string, input: unknown): Promise<string> {
  const rootReal = await realpath(root)
  const target = resolve(rootReal, ensureRelativePath(input))
  const parentReal = await realpath(dirname(target))
  if (!isInside(parentReal, rootReal) || !isInside(target, rootReal)) throw new Error('路径超出当前会话工作区')
  return target
}

async function walkFiles(root: string, start: string, limit = 400): Promise<string[]> {
  const results: string[] = []
  const pending = [start]
  while (pending.length > 0 && results.length < limit) {
    const current = pending.shift()!
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (['.git', '.gllm', 'node_modules', 'dist', 'out'].includes(entry.name)) continue
      const fullPath = resolve(current, entry.name)
      if (entry.isDirectory()) pending.push(fullPath)
      else if (entry.isFile()) results.push(relative(root, fullPath))
      if (results.length >= limit) break
    }
  }
  return results
}

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

export async function extractDocumentText(path: string): Promise<string> {
  const extension = extname(path).toLocaleLowerCase()
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
  if (extension === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: await readFile(path) })
    try {
      return (await parser.getText()).text
    } finally {
      await parser.destroy()
    }
  }
  throw new Error('read_document 当前支持 .pdf、.docx 和 .pptx')
}

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
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim()
}

function docxRun(text: string, options: { bold?: boolean; size?: number } = {}): string {
  const properties = [
    options.bold ? '<w:b/>' : '',
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
    '<w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/>'
  ].join('')
  return `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

function docxParagraph(text: string, style?: string): string {
  const paragraphProperties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${paragraphProperties}${text ? docxRun(text) : ''}</w:p>`
}

function markdownToDocxParagraphs(content: string): string {
  const paragraphs: string[] = []
  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      paragraphs.push('<w:p/>')
      continue
    }
    if (/^[-*_]{3,}$/.test(line)) continue
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      paragraphs.push(docxParagraph(normalizeMarkdownInline(heading[2]), `Heading${Math.min(3, heading[1].length)}`))
      continue
    }
    const bullet = line.match(/^[-*+]\s+(.+)$/)
    if (bullet) {
      paragraphs.push(docxParagraph(`• ${normalizeMarkdownInline(bullet[1])}`, 'ListParagraph'))
      continue
    }
    const numbered = line.match(/^(\d+)[.)、]\s*(.+)$/)
    if (numbered) {
      paragraphs.push(docxParagraph(`${numbered[1]}. ${normalizeMarkdownInline(numbered[2])}`, 'ListParagraph'))
      continue
    }
    if (/^\|?\s*:?-{3,}/.test(line) && line.includes('|')) continue
    if (line.includes('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => normalizeMarkdownInline(cell))
      paragraphs.push(docxParagraph(cells.join('    |    '), 'TableText'))
      continue
    }
    const quote = line.match(/^>\s*(.+)$/)
    paragraphs.push(docxParagraph(normalizeMarkdownInline(quote?.[1] ?? line), quote ? 'Quote' : undefined))
  }
  return paragraphs.join('')
}

export async function createDocxBuffer(title: string, content: string, author: string): Promise<Buffer> {
  const archive = new JSZip()
  const now = new Date().toISOString()
  const body = [title.trim() ? docxParagraph(title.trim(), 'Title') : '', markdownToDocxParagraphs(content)].join('')
  archive.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`)
  archive.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`)
  archive.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  archive.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`)
  archive.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="360"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="300" w:after="150"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420" w:hanging="220"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="480" w:right="480"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style></w:styles>`)
  archive.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(author || 'G-LLM')}</dc:creator><cp:lastModifiedBy>G-LLM</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`)
  archive.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>G-LLM</Application><AppVersion>1.0</AppVersion></Properties>`)
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

async function snapshotWorkspace(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  for (const file of await walkFiles(root, root, 5000)) {
    try {
      const info = await stat(resolve(root, file))
      snapshot.set(file, `${info.size}:${info.mtimeMs}`)
    } catch { /* file changed while taking the snapshot */ }
  }
  return snapshot
}

function workspaceRunnerPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', 'workspace-script-runner.cjs')
    : join(app.getAppPath(), 'resources', 'workspace-script-runner.cjs')
}

function friendlyScriptError(raw: string, language: WorkspaceAgentRequest['settings']['language']): string {
  const isEnglish = mainT('main.locale', language) === 'en-US'
  const missingCell = raw.match(/Error:\s*cell\s+([A-Z]+\d+)\s+not found/i)?.[1]
  if (missingCell) {
    return isEnglish
      ? `The script tried to update Excel cell ${missingCell}, but that cell was not found in the workbook XML. The script needs to inspect the sheet structure before editing it.`
      : `脚本准备修改 Excel 单元格 ${missingCell}，但在工作簿内部结构中没有找到该单元格。模板可能采用了不同的存储方式，需要先检查工作表结构再修改。`
  }
  const missingGlobal = raw.match(/ReferenceError:\s*([A-Za-z_$][\w$]*)\s+is not defined/i)?.[1]
  if (missingGlobal) {
    return isEnglish
      ? `The script requested “${missingGlobal}”, but that capability is not available in the isolated environment. This is a compatibility issue, not a file permission problem.`
      : `脚本使用了隔离环境尚未提供的“${missingGlobal}”功能。这属于脚本兼容性问题，不是文件权限不足。`
  }
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim())?.replace(/^Error:\s*/i, '').trim()
  return firstLine || (isEnglish ? 'The temporary script failed' : '临时脚本运行失败')
}

async function runWorkspaceJavascript(
  root: string,
  code: string,
  purpose: string,
  language: WorkspaceAgentRequest['settings']['language']
): Promise<{ output: string; changedFiles: string[] }> {
  if (!code.trim()) throw new Error('脚本代码不能为空')
  if (Buffer.byteLength(code) > 120_000) throw new Error('单次脚本不能超过 120 KB')
  if (/pdf|压缩|文件大小|字节|byte|resize/i.test(purpose) && /writeBase64\s*\(/i.test(code)) {
    throw new Error('禁止用通用脚本覆写或填充 PDF 二进制数据；请使用 compress_pdf 进行真实画质压缩')
  }
  const before = await snapshotWorkspace(root)
  const runDirectory = resolve(root, '.gllm', 'runs')
  await mkdir(runDirectory, { recursive: true })
  const scriptPath = resolve(runDirectory, `${Date.now()}-${randomUUID()}.js`)
  await writeFile(scriptPath, code, 'utf8')
  const runner = workspaceRunnerPath()

  const execution = await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      '--permission',
      `--allow-fs-read=${root}`,
      `--allow-fs-read=${runner}`,
      `--allow-fs-write=${root}`,
      runner,
      root,
      scriptPath
    ], {
      cwd: root,
      windowsHide: true,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        LANG: process.env.LANG ?? 'zh_CN.UTF-8',
        LC_ALL: process.env.LC_ALL ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        TEMP: process.env.TEMP ?? '',
        TMP: process.env.TMP ?? '',
        TMPDIR: process.env.TMPDIR ?? ''
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-80_000)
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('脚本运行超过 30 秒，已终止'))
    }, 30_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (exitCode) => {
      clearTimeout(timeout)
      if (exitCode !== 0) reject(new Error(friendlyScriptError(stderr.trim().slice(-4000) || `Exit code ${exitCode}`, language)))
      else resolvePromise({ stdout, stderr })
    })
  })

  const after = await snapshotWorkspace(root)
  const changedFiles = Array.from(after.entries())
    .filter(([file, signature]) => before.get(file) !== signature)
    .map(([file]) => file)
    .slice(0, 200)
  let summary = execution.stdout.trim()
  try {
    const payload = JSON.parse(summary) as { result?: unknown; logs?: string[] }
    summary = [
      ...(payload.logs ?? []).slice(-30),
      ...(payload.result === null || payload.result === undefined ? [] : [`返回结果：${typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result)}`])
    ].join('\n')
  } catch { /* keep raw output for diagnostics */ }
  const fileSummary = changedFiles.length > 0 ? `\n生成或修改：${changedFiles.join('、')}` : '\n未检测到文件变化'
  return { output: `脚本任务：${purpose.trim().slice(0, 300) || '处理工作区文件'}\n${summary || '脚本执行完成'}${fileSummary}`.slice(0, 12_000), changedFiles }
}

async function executeTool(
  request: WorkspaceAgentRequest,
  root: string,
  permission: 'read' | 'read-write',
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ output: string; changedFile?: string; changedFiles?: string[] }> {
  signal?.throwIfAborted()
  const requireWrite = () => {
    if (permission !== 'read-write') throw new Error('当前会话只有读取权限')
  }
  if (name === 'list_directory') {
    const target = await resolveExisting(root, args.path)
    const entries = await readdir(target, { withFileTypes: true })
    return { output: entries.slice(0, 300).map((entry) => `${entry.isDirectory() ? '[目录]' : '[文件]'} ${entry.name}`).join('\n') || '[空目录]' }
  }
  if (name === 'inspect_file') {
    const target = await resolveExisting(root, args.path)
    const info = await stat(target)
    return { output: JSON.stringify({ path: relative(root, target) || '.', type: info.isDirectory() ? 'directory' : 'file', size: info.size, modifiedAt: info.mtime.toISOString() }) }
  }
  if (name === 'read_file') {
    const target = await resolveExisting(root, args.path)
    const info = await stat(target)
    if (!info.isFile()) throw new Error('目标不是文件')
    if (info.size > 512_000) throw new Error('文本文件超过 500 KiB，请先缩小读取范围')
    return { output: (await readFile(target, 'utf8')).slice(0, 300_000) }
  }
  if (name === 'read_document') {
    const target = await resolveExisting(root, args.path)
    const info = await stat(target)
    if (!info.isFile()) throw new Error('目标不是文件')
    if (info.size > 80 * 1024 * 1024) throw new Error('文档超过 80 MB，当前版本不自动读取')
    const text = await extractDocumentText(target)
    if (!text.trim()) throw new Error('文档中没有提取到可读文字，可能是扫描件或纯图片文档')
    const offset = Math.max(0, Math.min(text.length, Math.round(Number(args.offset) || 0)))
    const maxCharacters = Math.max(5_000, Math.min(120_000, Math.round(Number(args.maxCharacters) || 60_000)))
    const end = Math.min(text.length, offset + maxCharacters)
    const range = text.slice(offset, end)
    const continuation = end < text.length ? `\n\n[文档尚未读完：本次范围 ${offset}-${end}，总字符数 ${text.length}；继续读取时传 offset=${end}]` : ''
    return { output: `${range}${continuation}` }
  }
  if (name === 'create_docx') {
    requireWrite()
    const target = await resolveWritable(root, args.output)
    if (extname(target).toLocaleLowerCase() !== '.docx') throw new Error('Word 输出文件必须使用 .docx 扩展名')
    const content = String(args.content ?? '').trim()
    if (!content) throw new Error('Word 文档正文不能为空')
    if (Buffer.byteLength(content) > 900_000) throw new Error('单次生成的 Word 正文不能超过 900 KB')
    const buffer = await createDocxBuffer(
      String(args.title ?? '').trim(),
      content,
      String(args.author ?? '').trim()
    )
    await writeFile(target, buffer)
    const verifiedText = await extractDocumentText(target)
    const info = await stat(target)
    if (!verifiedText.trim() || info.size < 1_000) throw new Error('Word 文档已写入，但重新读取验证失败')
    return {
      output: `已生成并验证 ${relative(root, target)}（${info.size} 字节，可读取正文 ${verifiedText.trim().length} 字）`,
      changedFile: relative(root, target)
    }
  }
  if (name === 'write_file') {
    requireWrite()
    const target = await resolveWritable(root, args.path)
    const content = String(args.content ?? '')
    if (Buffer.byteLength(content) > 1_000_000) throw new Error('单次写入不能超过 1 MB')
    await writeFile(target, content, { encoding: 'utf8', flag: 'w' })
    return { output: `已写入 ${relative(root, target)}（${Buffer.byteLength(content)} 字节）`, changedFile: relative(root, target) }
  }
  if (name === 'replace_text') {
    requireWrite()
    const target = await resolveExisting(root, args.path)
    const oldText = String(args.oldText ?? '')
    const newText = String(args.newText ?? '')
    if (!oldText) throw new Error('oldText 不能为空')
    const content = await readFile(target, 'utf8')
    const occurrences = content.split(oldText).length - 1
    if (occurrences === 0) throw new Error('没有找到要替换的原文')
    if (!args.replaceAll && occurrences > 1) throw new Error(`原文出现 ${occurrences} 次，请提供更精确的上下文或使用 replaceAll`)
    const next = args.replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText)
    await writeFile(target, next, 'utf8')
    return { output: `已修改 ${relative(root, target)}，替换 ${args.replaceAll ? occurrences : 1} 处`, changedFile: relative(root, target) }
  }
  if (name === 'create_directory') {
    requireWrite()
    const target = resolve(await realpath(root), ensureRelativePath(args.path))
    if (!isInside(target, await realpath(root))) throw new Error('路径超出当前会话工作区')
    await mkdir(target, { recursive: true })
    return { output: `已创建目录 ${relative(root, target)}` }
  }
  if (name === 'move_file') {
    requireWrite()
    const from = await resolveExisting(root, args.from)
    const to = await resolveWritable(root, args.to)
    await rename(from, to)
    return { output: `已移动 ${relative(root, from)} → ${relative(root, to)}`, changedFile: relative(root, to) }
  }
  if (name === 'search_files') {
    const start = await resolveExisting(root, args.path)
    const query = String(args.query ?? '').toLocaleLowerCase()
    if (!query) throw new Error('搜索关键词不能为空')
    const files = await walkFiles(await realpath(root), start)
    const matched: string[] = []
    for (const file of files) {
      if (file.toLocaleLowerCase().includes(query)) matched.push(file)
      else if (args.includeContent) {
        try {
          const full = await resolveExisting(root, file)
          const info = await stat(full)
          if (info.size <= 256_000 && (await readFile(full, 'utf8')).toLocaleLowerCase().includes(query)) matched.push(file)
        } catch { /* binary or unreadable file */ }
      }
      if (matched.length >= 100) break
    }
    return { output: matched.join('\n') || '未找到匹配文件' }
  }
  if (name === 'compress_image' || name === 'compress_pdf') {
    requireWrite()
    const source = await resolveExisting(root, args.source)
    const output = await resolveWritable(root, args.output)
    const targetBytes = Math.max(10_000, Math.min(100 * 1024 * 1024, Number(args.targetBytes) || 2 * 1024 * 1024))
    const minimumBytes = Math.max(0, Math.min(targetBytes, Number(args.minimumBytes) || 0))
    const buffer = name === 'compress_pdf'
      ? await renderPdfToTarget(source, targetBytes, undefined, minimumBytes, request.settings.language)
      : await compressImageToTarget(source, targetBytes, request.settings.language)
    await writeFile(output, buffer, { flag: 'wx' })
    const info = await stat(output)
    if (info.size > targetBytes) throw new Error('输出文件仍超过目标大小')
    return { output: `已生成 ${relative(root, output)}（${info.size} 字节，目标不超过 ${targetBytes} 字节）`, changedFile: relative(root, output) }
  }
  if (name === 'run_javascript') {
    requireWrite()
    return runWorkspaceJavascript(root, String(args.code ?? ''), String(args.purpose ?? ''), request.settings.language)
  }
  if (name === 'generate_image') {
    requireWrite()
    const prompt = String(args.prompt ?? '').trim()
    if (!prompt) throw new Error('图片提示词不能为空')
    const output = await resolveWritable(root, args.output)
    const path = request.provider.imageGenerationsPath ?? '/images/generations'
    const endpoint = `${request.provider.apiBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { ...(request.provider.apiKey ? { Authorization: `Bearer ${request.provider.apiKey}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: request.provider.defaultModel, prompt, n: 1, response_format: 'b64_json' }),
      signal: requestSignal(signal, 180_000)
    })
    if (!response.ok) throw new Error(`图片生成失败：${response.status} ${(await response.text()).slice(0, 240)}`)
    const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
    const item = payload.data?.[0]
    let buffer: Buffer
    if (item?.b64_json) buffer = Buffer.from(item.b64_json, 'base64')
    else if (item?.url && /^https?:\/\//i.test(item.url)) {
      const imageResponse = await fetch(item.url, { signal: requestSignal(signal, 120_000) })
      if (!imageResponse.ok) throw new Error(`生成图片下载失败：${imageResponse.status}`)
      buffer = Buffer.from(await imageResponse.arrayBuffer())
    } else throw new Error('图片生成接口没有返回图片数据')
    const image = await loadImage(buffer)
    const canvas = createCanvas(image.width, image.height)
    canvas.getContext('2d').drawImage(image, 0, 0)
    const normalized = canvas.toBuffer('image/png')
    await writeFile(output, normalized, { flag: 'wx' })
    return { output: `已生成图片 ${relative(root, output)}（${normalized.length} 字节）`, changedFile: relative(root, output) }
  }
  throw new Error(`不支持的工具：${name}`)
}

function activityLabel(tool: string, request: WorkspaceAgentRequest): string {
  const knownTools = new Set([
    'list_directory', 'inspect_file', 'read_file', 'read_document', 'create_docx', 'write_file', 'replace_text',
    'create_directory', 'move_file', 'search_files', 'compress_image', 'compress_pdf', 'run_javascript', 'generate_image'
  ])
  return knownTools.has(tool) ? mainT(`main.workspace.tools.${tool}`, request.settings.language) : tool
}

function extractJson(value: string): Record<string, unknown> | null {
  const candidate = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value.match(/\{[\s\S]*\}/)?.[0] ?? ''
  try { return JSON.parse(candidate) as Record<string, unknown> } catch { return null }
}

function selectRecentImageAttachments(messages: ChatMessage[]): Set<string> {
  const selected = new Set<string>()
  let totalBytes = 0
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const attachments = messages[messageIndex].attachments ?? []
    for (let attachmentIndex = attachments.length - 1; attachmentIndex >= 0; attachmentIndex -= 1) {
      const attachment = attachments[attachmentIndex]
      if (attachment.kind !== 'image' || !attachment.dataUrl || selected.size >= 4) continue
      if (totalBytes + attachment.size > 12 * 1024 * 1024) continue
      selected.add(attachment.id)
      totalBytes += attachment.size
    }
    if (selected.size >= 4) break
  }
  return selected
}

function toAgentMessageContent(message: ChatMessage, selectedImages: Set<string>): AgentMessageContent {
  const textSections = [message.content]
  for (const attachment of message.attachments ?? []) {
    if (attachment.text?.trim()) {
      textSections.push(`[附件正文：${attachment.name}]\n${attachment.text.slice(0, 120_000)}`)
    } else if (attachment.kind === 'image' && !selectedImages.has(attachment.id)) {
      textSections.push(`[图片附件：${attachment.name}，本轮未重复发送图片数据]`)
    } else if (attachment.kind !== 'image') {
      textSections.push(`[附件：${attachment.name}，未提取到正文]`)
    }
  }
  for (const reference of message.knowledgeRefs ?? []) {
    textSections.push(`[引用资料：${reference.title}]\n${reference.content.slice(0, 80_000)}`)
  }
  if (message.workspaceChangedFiles?.length) {
    textSections.push(`[该轮生成或修改的文件]\n${message.workspaceChangedFiles.slice(0, 50).join('\n')}`)
  }
  const completedActivities = (message.workspaceActivities ?? [])
    .filter((activity) => activity.status !== 'running')
    .slice(-12)
    .map((activity) => `${activity.label}：${activity.status === 'failed' ? '失败' : '完成'}${activity.detail ? `；${activity.detail}` : ''}`)
  if (completedActivities.length) {
    textSections.push(`[该轮工作区操作]\n${completedActivities.join('\n')}`)
  }
  const text = textSections.filter(Boolean).join('\n\n') || '[空消息]'
  const images = (message.attachments ?? [])
    .filter((attachment) => attachment.kind === 'image' && attachment.dataUrl && selectedImages.has(attachment.id))
    .map((attachment) => ({ type: 'image_url' as const, image_url: { url: attachment.dataUrl! } }))
  return images.length > 0 ? [{ type: 'text', text }, ...images] : text
}

function fallbackMessages(messages: AgentMessage[]): Array<{ role: 'system' | 'user' | 'assistant'; content: AgentMessageContent }> {
  const fallbackToolCatalog = toolDefinitions.map((tool) => ({ name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters }))
  const protocol = `当前供应商不支持原生 tools 参数。可用工具定义：${JSON.stringify(fallbackToolCatalog)}。需要调用工具时只返回 JSON：{"tool":"工具名","arguments":{}}。任务完成时只返回 JSON：{"final":"给用户的最终说明"}。一次只调用一个工具。`
  return messages.map((message, index): { role: 'system' | 'user' | 'assistant'; content: AgentMessageContent } => {
    if (index === 0) return { role: 'system', content: `${typeof message.content === 'string' ? message.content : ''}\n\n${protocol}` }
    if (message.role === 'tool') return { role: 'user' as const, content: `[工具结果 ${message.tool_call_id ?? ''}]\n${message.content ?? ''}` }
    if (message.tool_calls?.length) return { role: 'assistant' as const, content: message.content || `[已请求工具：${message.tool_calls.map((call) => call.function.name).join(', ')}]` }
    return { role: message.role === 'system' ? 'system' : message.role, content: message.content ?? '' }
  })
}

async function runWorkspaceAgentUnlocked(
  request: WorkspaceAgentRequest,
  onProgress?: (progress: WorkspaceAgentProgress) => void,
  onToolApproval?: WorkspaceToolApprovalHandler,
  signal?: AbortSignal
): Promise<WorkspaceAgentResult> {
  signal?.throwIfAborted()
  const root = await realpath(request.workspace.rootPath)
  const language = request.settings.language
  const isEnglish = mainT('main.locale', language) === 'en-US'
  const activities: WorkspaceToolActivity[] = []
  const changedFiles = new Set<string>()
  const latestUserRequest = request.messages.slice().reverse().find((message) => message.role === 'user')?.content ?? ''
  const actionRequested = /压缩|生成|创建|新建|修改|改成|替换|重命名|移动|整理|处理|转换|合并|拆分|写入|保存|编写|实现|修复|批量|compress|generate|create|modify|replace|rename|move|organize|process|convert|merge|split|write|save|implement|fix|batch/i.test(latestUserRequest)
  const conversationContext = prepareConversationContext(request.messages)
  const hasPriorWorkspaceObservation = request.messages.some((message) => (message.workspaceActivities?.length ?? 0) > 0)
  const latestMentionsWorkspace = /目录|文件夹|工作区|项目|代码库|仓库|文件|directory|folder|workspace|project|codebase|repository|repo|file/i.test(latestUserRequest)
  const shouldObserveWorkspace = !hasPriorWorkspaceObservation || latestMentionsWorkspace || actionRequested
  let workspaceObservation = '本轮沿用同一会话已授权的工作目录；用户最新消息未要求重新检查目录。'
  if (shouldObserveWorkspace) {
    const initialActivity: WorkspaceToolActivity = {
      id: `observe_${randomUUID()}`,
      tool: 'list_directory',
      label: mainT(hasPriorWorkspaceObservation ? 'main.workspace.syncFolder' : 'main.workspace.observeFolder', language),
      status: 'running'
    }
    activities.push(initialActivity)
    onProgress?.({ conversationId: request.conversationId, activity: { ...initialActivity } })
    try {
      const observation = await executeTool(request, root, request.workspace.permission, 'list_directory', { path: '.' }, signal)
      initialActivity.status = 'completed'
      initialActivity.detail = isEnglish
        ? mainT('main.workspace.folderObserved', language)
        : observation.output.slice(0, 240)
      workspaceObservation = `当前工作目录清单：\n${observation.output}`
    } catch (error) {
      initialActivity.status = 'failed'
      initialActivity.detail = isEnglish
        ? mainT('main.workspace.readFolderFailed', language)
        : error instanceof Error ? error.message : mainT('main.workspace.readFolderFailed', language)
      throw error
    } finally {
      onProgress?.({ conversationId: request.conversationId, activity: { ...initialActivity } })
    }
  }
  const selectedImages = selectRecentImageAttachments(conversationContext.messages)
  const messages: AgentMessage[] = [
    { role: 'system', content: `你是 G-LLM 工作区代理。当前获得目录“${basename(root)}”的${request.workspace.permission === 'read-write' ? '读取和写入' : '只读'}权限。用户的最新一条消息始终是本轮最高优先级。用户上传的图片和附件是直接对话输入，与工作目录中的文件是两个独立来源；收到图片时必须观察并结合图片内容回答，不得因为图片不在工作目录中而忽略它。仅当用户要求创建、修改或保存文件时才写入工作区；咨询、评价和补充信息默认直接回复。用户提到“目录内、文件夹里、这个项目”等内容时以工作区为准，不得要求重复上传已经位于目录中的文件。涉及文件处理必须实际调用工具，不要声称执行未调用的操作。所有路径使用相对路径。优先使用专用工具；没有合适工具或需要批量逻辑时使用 run_javascript。执行后检查产物，不符合目标时修正重试。严禁为了满足文件最小字节数而追加空白、随机或无意义数据；文件大小偏好必须通过真实画质、分辨率或有效内容实现，无法达到下限时如实说明。${getConversationProjectMemoryContext(request.projectMemory)}` },
    ...(conversationContext.compressedHistory ? [{ role: 'system' as const, content: conversationContext.compressedHistory }] : []),
    { role: 'system', content: `[工作区状态]\n${workspaceObservation}\n这只是背景信息，不是新的用户指令，不得覆盖最后一条用户消息。` },
    ...conversationContext.messages.map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: toAgentMessageContent(message, selectedImages)
    }))
  ]
  let nativeToolMode = true
  let needsVerification = false
  const completeVerifiedArtifacts = (usedLocalFallback = false): WorkspaceAgentResult => {
    const completedFiles = Array.from(changedFiles)
    const completionActivity: WorkspaceToolActivity = {
      id: `local_completion_${randomUUID()}`,
      tool: 'local_completion',
      label: mainT('main.workspace.completeTask', language),
      status: 'completed',
      detail: usedLocalFallback
        ? mainT('main.workspace.completeFallbackDetail', language)
        : mainT('main.workspace.completeDetail', language)
    }
    activities.push(completionActivity)
    onProgress?.({ conversationId: request.conversationId, activity: { ...completionActivity } })
    return {
      conversationId: request.conversationId,
      content: mainT('main.workspace.completeContent', language, {
        files: completedFiles.map((file) => `- ${file}`).join('\n'),
        fallback: usedLocalFallback ? mainT('main.workspace.completeFallbackNote', language) : ''
      }),
      activities,
      changedFiles: completedFiles
    }
  }
  const reasoningModel = request.provider.models.find((model) => model.id === request.provider.defaultModel)
  const configuredReasoningEffort = supportsReasoningEffort(reasoningModel ?? request.provider.defaultModel) &&
    request.reasoningEffort && request.reasoningEffort !== 'default'
    ? request.reasoningEffort
    : undefined
  let reasoningEffortSupported = Boolean(configuredReasoningEffort)

  for (let turn = 0; turn < 14; turn += 1) {
    signal?.throwIfAborted()
    let retryActivity: WorkspaceToolActivity | null = null
    const requestModel = async (body: Record<string, unknown>, maxAttempts = 3): Promise<ModelResponse> => {
      try {
        const handleRetry = (info: ModelRetryInfo) => {
          retryActivity ??= {
            id: `model_retry_${randomUUID()}`,
            tool: 'model_request_retry',
            label: mainT('main.workspace.retryModel', language),
            status: 'running'
          }
          retryActivity.detail = mainT('main.workspace.retryProgress', language, {
            reason: info.reason,
            current: info.attempt + 1,
            total: info.maxAttempts
          })
          onProgress?.({ conversationId: request.conversationId, activity: { ...retryActivity } })
        }
        let result = await fetchModelWithRetry(request, body, handleRetry, maxAttempts, signal)
        if (!result.response.ok && reasoningEffortSupported && 'reasoning_effort' in body && [400, 422].includes(result.response.status)) {
          await result.response.arrayBuffer().catch(() => undefined)
          reasoningEffortSupported = false
          const compatibleBody = { ...body }
          delete compatibleBody.reasoning_effort
          result = await fetchModelWithRetry(request, compatibleBody, handleRetry, maxAttempts, signal)
        }
        if (retryActivity) {
          retryActivity.status = result.response.ok ? 'completed' : 'failed'
          retryActivity.detail = result.response.ok
            ? mainT('main.workspace.retryRecovered', language, { detail: retryActivity.detail ?? mainT('main.workspace.retryModel', language) })
            : mainT('main.workspace.retryExhausted', language, { status: friendlyModelStatus(result.response.status, request) })
          activities.push(retryActivity)
          onProgress?.({ conversationId: request.conversationId, activity: { ...retryActivity } })
        }
        return result
      } catch (error) {
        if (retryActivity) {
          retryActivity.status = 'failed'
          retryActivity.detail = isEnglish
            ? mainT('main.workspace.retryFailed', language)
            : error instanceof Error ? error.message : mainT('main.workspace.retryFailed', language)
          activities.push(retryActivity)
          onProgress?.({ conversationId: request.conversationId, activity: { ...retryActivity } })
        }
        throw error
      }
    }
    const isArtifactSummaryRequest = changedFiles.size > 0 && !needsVerification
    let message: ModelMessage
    try {
      let result = await requestModel({
        model: request.provider.defaultModel,
        messages: nativeToolMode ? messages : fallbackMessages(messages),
        ...(nativeToolMode ? { tools: toolDefinitions, tool_choice: 'auto' } : {}),
        ...(reasoningEffortSupported && configuredReasoningEffort ? { reasoning_effort: configuredReasoningEffort } : {}),
        stream: true,
        temperature: request.settings.enableTemperature ? Math.min(request.settings.temperature, 0.4) : 0.2,
        max_tokens: request.settings.enableMaxTokens ? request.settings.maxTokens : 4096
      }, isArtifactSummaryRequest ? 1 : 3)
      if (!result.response.ok && nativeToolMode && [400, 404, 422].includes(result.response.status)) {
        nativeToolMode = false
        await result.response.arrayBuffer().catch(() => undefined)
        retryActivity = null
        result = await requestModel({
          model: request.provider.defaultModel,
          messages: fallbackMessages(messages),
          ...(reasoningEffortSupported && configuredReasoningEffort ? { reasoning_effort: configuredReasoningEffort } : {}),
          stream: true,
          temperature: 0.1,
          max_tokens: request.settings.enableMaxTokens ? request.settings.maxTokens : 4096
        }, isArtifactSummaryRequest ? 1 : 3)
      }
      if (!result.response.ok) throw new Error(mainT('main.workspace.modelStageFailed', language, { error: await safeResponseError(result.response, request) }))
      const responseMessage = result.message
      if (!responseMessage) throw new Error(mainT('main.workspace.noModelResponse', language))
      message = responseMessage
    } catch (error) {
      signal?.throwIfAborted()
      if (!isArtifactSummaryRequest) throw error
      return completeVerifiedArtifacts(true)
    }
    let calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (!nativeToolMode && calls.length === 0) {
      const instruction = extractJson(message.content ?? '')
      if (typeof instruction?.final === 'string') {
        message.content = instruction.final.trim() || mainT('main.workspace.taskEnded', language)
      }
      if (typeof instruction?.tool === 'string') {
        calls = [{ id: `fallback_${randomUUID()}`, type: 'function', function: { name: instruction.tool, arguments: JSON.stringify(instruction.arguments ?? {}) } }]
      }
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls })
    if (calls.length === 0) {
      if (needsVerification && turn < 12) {
        messages.push({
          role: 'user',
          content: '你刚才生成或修改了文件，但还没有验证结果。请使用 inspect_file、read_file 或其他合适工具检查产物是否存在、大小和内容是否符合用户目标；不符合时继续修正。'
        })
        continue
      }
      if (actionRequested && changedFiles.size === 0 && turn < 2) {
        messages.push({
          role: 'user',
          content: '你尚未调用任何会产生目标文件的工具，因此任务并未完成。不要要求用户重新上传工作目录中已经列出的文件；请立即检查目标文件并调用合适工具执行。'
        })
        continue
      }
      return { conversationId: request.conversationId, content: message.content?.trim() || mainT('main.workspace.taskEnded', language), activities, changedFiles: Array.from(changedFiles) }
    }
    for (const call of calls.slice(0, 6)) {
      const activity: WorkspaceToolActivity = { id: call.id || randomUUID(), tool: call.function.name, label: activityLabel(call.function.name, request), status: 'running' }
      activities.push(activity)
      onProgress?.({ conversationId: request.conversationId, activity: { ...activity } })
      try {
        const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
        const isScript = call.function.name === 'run_javascript'
        const writeTools = new Set(['create_docx', 'write_file', 'replace_text', 'create_directory', 'move_file', 'compress_image', 'compress_pdf', 'generate_image'])
        const canWrite = request.workspace.permission === 'read-write' && (
          writeTools.has(call.function.name) ||
          (isScript && /workspace\.(?:writeText|writeBase64|mkdir|copy|move)\s*\(/.test(String(args.code ?? '')))
        )
        const approvalMode = request.workspace.approvalMode ?? 'ask'
        const needsApproval = approvalMode === 'ask'
          ? isScript || canWrite
          : approvalMode === 'auto'
            ? isScript && canWrite
            : false
        if (needsApproval && onToolApproval) {
          const target = String(args.path ?? args.output ?? args.to ?? '').trim()
          const purpose = isScript
            ? String(args.purpose ?? '').trim() || (isEnglish ? 'Process files in the workspace' : '处理工作区中的文件')
            : `${activity.label}${target ? (isEnglish ? `: ${target}` : `：${target}`) : ''}`
          activity.detail = isEnglish ? 'Waiting for your approval' : '等待你确认是否允许运行'
          onProgress?.({ conversationId: request.conversationId, activity: { ...activity } })
          const approved = await onToolApproval({
            tool: 'run_javascript',
            purpose,
            workspaceName: request.workspace.displayName,
            canWrite,
            isScript
          })
          signal?.throwIfAborted()
          if (!approved) throw new Error(isEnglish ? 'You did not approve this script' : '用户未批准运行此脚本')
          activity.detail = isEnglish ? 'Approved; running in the isolated workspace' : '已获批准，正在隔离环境中运行'
          onProgress?.({ conversationId: request.conversationId, activity: { ...activity } })
        }
        const result = await executeTool(request, root, request.workspace.permission, call.function.name, args, signal)
        if (result.changedFile) {
          changedFiles.add(result.changedFile)
          needsVerification = true
        }
        for (const file of result.changedFiles ?? []) {
          changedFiles.add(file)
          needsVerification = true
        }
        if (['inspect_file', 'read_file', 'read_document'].includes(call.function.name) && needsVerification) needsVerification = false
        activity.status = 'completed'
        activity.detail = isEnglish
          ? mainT('main.workspace.toolCompleted', language, { tool: activity.label })
          : result.output.slice(0, 240)
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.output })
      } catch (error) {
        signal?.throwIfAborted()
        activity.status = 'failed'
        activity.detail = isEnglish
          ? mainT('main.workspace.toolFailed', language, { tool: activity.label })
          : error instanceof Error ? error.message : mainT('main.workspace.toolFailed', language, { tool: activity.label })
        messages.push({ role: 'tool', tool_call_id: call.id, content: `错误：${activity.detail}` })
      }
      onProgress?.({ conversationId: request.conversationId, activity: { ...activity } })
    }
    if (changedFiles.size > 0 && !needsVerification) return completeVerifiedArtifacts()
  }
  return { conversationId: request.conversationId, content: mainT('main.workspace.maxSteps', language), activities, changedFiles: Array.from(changedFiles) }
}

export async function runWorkspaceAgent(
  request: WorkspaceAgentRequest,
  onProgress?: (progress: WorkspaceAgentProgress) => void,
  onToolApproval?: WorkspaceToolApprovalHandler,
  signal?: AbortSignal
): Promise<WorkspaceAgentResult> {
  signal?.throwIfAborted()
  const root = await realpath(request.workspace.rootPath)
  const lockKey = process.platform === 'linux' ? root : root.toLocaleLowerCase()
  const owner = workspaceRunLocks.get(lockKey)
  if (owner) {
    throw new Error(mainT(
      owner === request.conversationId ? 'main.workspace.alreadyRunning' : 'main.workspace.folderBusy',
      request.settings.language
    ))
  }
  workspaceRunLocks.set(lockKey, request.conversationId)
  try {
    return await runWorkspaceAgentUnlocked(request, onProgress, onToolApproval, signal)
  } finally {
    if (workspaceRunLocks.get(lockKey) === request.conversationId) workspaceRunLocks.delete(lockKey)
  }
}
