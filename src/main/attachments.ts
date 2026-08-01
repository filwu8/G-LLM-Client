/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { BrowserWindow } from 'electron'
import { dialog } from 'electron'
import { createCanvas, DOMMatrix, ImageData, loadImage, Path2D } from '@napi-rs/canvas'
import mammoth from 'mammoth'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import type { AppLanguage } from '../shared/i18n'
import type { AttachmentKind, ClipboardAttachmentInput, PreparedAttachment } from '../shared/types'
import { mainT } from './i18n'

const maxTextBytes = 2 * 1024 * 1024
const maxDocumentBytes = 12 * 1024 * 1024
const maxImageBytes = 8 * 1024 * 1024
const maxImageSide = 2048
const sendableImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const selectedAttachmentPaths = new Map<string, string>()

const textExtensions = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.sql',
  '.log',
  '.yml',
  '.yaml',
  '.ini',
  '.toml'
])

const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const pdfExtensions = new Set(['.pdf'])
const wordExtensions = new Set(['.docx'])

type PdfParseModule = typeof import('pdf-parse')

let pdfParseModulePromise: Promise<PdfParseModule> | null = null

function installPdfDomPolyfills(): void {
  globalThis.DOMMatrix ??= DOMMatrix as unknown as typeof globalThis.DOMMatrix
  globalThis.ImageData ??= ImageData as unknown as typeof globalThis.ImageData
  globalThis.Path2D ??= Path2D as unknown as typeof globalThis.Path2D
}

async function loadPdfParse(): Promise<PdfParseModule> {
  installPdfDomPolyfills()
  pdfParseModulePromise ??= import('pdf-parse')
  return pdfParseModulePromise
}

const mimeByExtension: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.sql': 'application/sql'
}

function createAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getMimeType(filePath: string, kind: AttachmentKind): string {
  const extension = extname(filePath).toLowerCase()
  return mimeByExtension[extension] ?? (kind === 'image' ? 'image/*' : 'application/octet-stream')
}

function getMimeTypeByName(name: string, kind: AttachmentKind, mimeType?: string): string {
  const extension = extname(name).toLowerCase()
  return mimeType || mimeByExtension[extension] || (kind === 'image' ? 'image/*' : 'application/octet-stream')
}

function normalizeText(text: string): string {
  return text.replace(/\u0000/g, '').slice(0, 40_000)
}

function normalizeImageMimeType(mimeType: string): string {
  return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType
}

async function compressImageForVision(buffer: Buffer): Promise<{ dataUrl: string; mimeType: string; size: number }> {
  const image = await loadImage(buffer)
  const sourceWidth = Math.max(1, image.width)
  const sourceHeight = Math.max(1, image.height)
  let targetSide = Math.min(maxImageSide, Math.max(sourceWidth, sourceHeight))
  let quality = 0.88
  let best: Buffer | null = null

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const scale = Math.min(1, targetSide / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')

    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)

    const output = canvas.toBuffer('image/jpeg', quality)
    if (!best || output.length < best.length) best = output
    if (output.length <= maxImageBytes) {
      return {
        dataUrl: `data:image/jpeg;base64,${output.toString('base64')}`,
        mimeType: 'image/jpeg',
        size: output.length
      }
    }

    if (quality > 0.62) {
      quality -= 0.1
    } else {
      targetSide = Math.max(768, Math.floor(targetSide * 0.75))
      quality = 0.82
    }
  }

  if (!best) throw new Error('图片压缩失败')
  return {
    dataUrl: `data:image/jpeg;base64,${best.toString('base64')}`,
    mimeType: 'image/jpeg',
    size: best.length
  }
}

async function prepareImageForVision(buffer: Buffer, mimeType: string): Promise<{ dataUrl: string; mimeType: string; size: number }> {
  const normalizedMimeType = normalizeImageMimeType(mimeType)
  if (buffer.length <= maxImageBytes && sendableImageMimeTypes.has(normalizedMimeType)) {
    return {
      dataUrl: `data:${normalizedMimeType};base64,${buffer.toString('base64')}`,
      mimeType: normalizedMimeType,
      size: buffer.length
    }
  }

  return compressImageForVision(buffer)
}

async function readPdfText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  const { PDFParse } = await loadPdfParse()
  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText()
    return normalizeText(result.text)
  } finally {
    await parser.destroy()
  }
}

async function readWordText(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath })
  return normalizeText(result.value)
}

async function readPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  const { PDFParse } = await loadPdfParse()
  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText()
    return normalizeText(result.text)
  } finally {
    await parser.destroy()
  }
}

async function readWordTextFromBuffer(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return normalizeText(result.value)
}

function parseDataUrl(dataUrl?: string): Buffer | null {
  if (!dataUrl) return null
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) return null

  const payload = match[3] ?? ''
  return match[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8')
}

function getMimeTypeFromDataUrl(dataUrl: string, fallbackMimeType: string): string {
  return normalizeImageMimeType(dataUrl.match(/^data:([^;,]+)?[;,]/)?.[1] || fallbackMimeType)
}

export async function prepareImageDataUrlForVision(
  dataUrl: string,
  fallbackMimeType = 'image/png'
): Promise<{ dataUrl: string; mimeType: string; size: number } | null> {
  const buffer = parseDataUrl(dataUrl)
  if (!buffer) return null

  return prepareImageForVision(buffer, getMimeTypeFromDataUrl(dataUrl, fallbackMimeType)).catch(() => null)
}

async function readAttachment(filePath: string, kind: AttachmentKind): Promise<PreparedAttachment> {
  const fileStat = await stat(filePath)
  const extension = extname(filePath).toLowerCase()
  const actualKind: AttachmentKind = kind === 'image' || imageExtensions.has(extension) ? 'image' : 'file'
  const mimeType = getMimeType(filePath, actualKind)
  const base: PreparedAttachment = {
    id: createAttachmentId(),
    name: basename(filePath),
    mimeType,
    size: fileStat.size,
    kind: actualKind,
    localExecutable: true
  }
  selectedAttachmentPaths.set(base.id, filePath)
  if (selectedAttachmentPaths.size > 200) {
    const oldestId = selectedAttachmentPaths.keys().next().value
    if (oldestId) selectedAttachmentPaths.delete(oldestId)
  }

  if (actualKind === 'image') {
    const buffer = await readFile(filePath)
    const image = await prepareImageForVision(buffer, mimeType).catch(() => null)
    if (!image) return base
    return {
      ...base,
      mimeType: image.mimeType,
      size: image.size,
      dataUrl: image.dataUrl
    }
  }

  if (fileStat.size <= maxDocumentBytes && pdfExtensions.has(extension)) {
    return {
      ...base,
      text: await readPdfText(filePath).catch(() => '')
    }
  }

  if (fileStat.size <= maxDocumentBytes && wordExtensions.has(extension)) {
    return {
      ...base,
      text: await readWordText(filePath).catch(() => '')
    }
  }

  if (fileStat.size <= maxTextBytes && textExtensions.has(extension)) {
    const text = await readFile(filePath, 'utf8')
    return {
      ...base,
      text: normalizeText(text)
    }
  }

  return base
}

export function getSelectedAttachmentPath(attachmentId: string): string | undefined {
  return selectedAttachmentPaths.get(attachmentId)
}

function getClipboardAttachmentName(input: ClipboardAttachmentInput, index: number): string {
  const name = input.name?.trim()
  if (name) return name
  if (input.kind === 'image' || input.mimeType.startsWith('image/')) return `粘贴图片_${index + 1}.png`
  return `粘贴附件_${index + 1}`
}

async function prepareClipboardAttachment(input: ClipboardAttachmentInput, index: number): Promise<PreparedAttachment> {
  const name = getClipboardAttachmentName(input, index)
  const extension = extname(name).toLowerCase()
  const actualKind: AttachmentKind =
    input.kind === 'image' || input.mimeType.startsWith('image/') || imageExtensions.has(extension) ? 'image' : 'file'
  const mimeType = getMimeTypeByName(name, actualKind, input.mimeType)
  const size = Number.isFinite(input.size) ? Math.max(0, Number(input.size)) : 0
  const buffer = parseDataUrl(input.dataUrl)
  const base: PreparedAttachment = {
    id: createAttachmentId(),
    name,
    mimeType,
    size,
    kind: actualKind
  }

  if (actualKind === 'image') {
    if (!buffer) return base
    const image = await prepareImageForVision(buffer, mimeType).catch(() => null)
    if (!image) return base
    return {
      ...base,
      mimeType: image.mimeType,
      size: image.size,
      dataUrl: image.dataUrl
    }
  }

  if (size <= maxDocumentBytes && buffer && (pdfExtensions.has(extension) || mimeType === 'application/pdf')) {
    return {
      ...base,
      text: await readPdfTextFromBuffer(buffer).catch(() => '')
    }
  }

  if (
    size <= maxDocumentBytes &&
    buffer &&
    (wordExtensions.has(extension) || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  ) {
    return {
      ...base,
      text: await readWordTextFromBuffer(buffer).catch(() => '')
    }
  }

  if (size <= maxTextBytes && (input.text || buffer) && (textExtensions.has(extension) || mimeType.startsWith('text/'))) {
    return {
      ...base,
      text: normalizeText(input.text ?? buffer?.toString('utf8') ?? '')
    }
  }

  return base
}

export async function pickAttachments(
  owner: BrowserWindow | null,
  kind: AttachmentKind,
  language: AppLanguage
): Promise<PreparedAttachment[]> {
  const options: Electron.OpenDialogOptions = {
    title: mainT(kind === 'image' ? 'native.chooseImage' : 'native.chooseAttachment', language),
    properties: ['openFile', 'multiSelections'],
    filters:
      kind === 'image'
        ? [{ name: mainT('native.images', language), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
        : [
            {
              name: mainT('native.documentsImagesText', language),
              extensions: [
                'pdf',
                'docx',
                'png',
                'jpg',
                'jpeg',
                'webp',
                'gif',
                ...Array.from(textExtensions).map((extension) => extension.slice(1))
              ]
            },
            { name: mainT('native.allFiles', language), extensions: ['*'] }
          ]
  }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)

  if (result.canceled) return []

  const selected = await Promise.all(result.filePaths.slice(0, 8).map((filePath) => readAttachment(filePath, kind)))
  return selected
}

export async function preparePastedAttachments(inputs: ClipboardAttachmentInput[]): Promise<PreparedAttachment[]> {
  return Promise.all(inputs.slice(0, 8).map((input, index) => prepareClipboardAttachment(input, index)))
}
