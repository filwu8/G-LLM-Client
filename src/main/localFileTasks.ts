/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { createCanvas, DOMMatrix, ImageData, loadImage, Path2D } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { AppLanguage } from '../shared/i18n'
import type {
  LocalTaskArtifact,
  LocalTaskFilePlan,
  LocalTaskPlan,
  LocalTaskProgress,
  LocalTaskResult
} from '../shared/types'
import { getSelectedAttachmentPath } from './attachments'
import { mainT } from './i18n'

const defaultTargetBytes = 2 * 1024 * 1024
const maxTargetBytes = 100 * 1024 * 1024
const plans = new Map<string, LocalTaskPlan>()
const taskOutputDirectories = new Map<string, string>()
const cancelledPlans = new Set<string>()
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const pdfExtension = '.pdf'

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

function parseTargetBytes(request: string): number {
  const explicitBytes = request.match(/(?:最多|限制|小于|不超过|低于|压缩到)?\s*(\d{5,9})\s*(?:字节|bytes?)?/i)
  if (explicitBytes) return Math.min(maxTargetBytes, Math.max(1024, Number(explicitBytes[1])))

  const unitValue = request.match(/(\d+(?:\.\d+)?)\s*(mib|mb|兆|m|kib|kb|k)(?:\s|以下|以内|之内|$)/i)
  if (!unitValue) return defaultTargetBytes
  const value = Number(unitValue[1])
  const unit = unitValue[2].toLowerCase()
  const multiplier = unit.startsWith('k') ? 1024 : 1024 * 1024
  return Math.min(maxTargetBytes, Math.max(1024, Math.floor(value * multiplier)))
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Number((bytes / 1024 / 1024).toFixed(2))} MiB`
  if (bytes >= 1024) return `${Number((bytes / 1024).toFixed(1))} KiB`
  return `${bytes} B`
}

function uniqueOutputName(name: string, index: number, action: LocalTaskFilePlan['action'], language: AppLanguage): string {
  const extension = extname(name)
  const stem = basename(name, extension)
  const outputExtension = action === 'compress-image' ? '.jpg' : action === 'compress-pdf' ? '.pdf' : extension || '.bin'
  return `${stem}_${mainT('main.localTask.processedSuffix', language)}${index > 0 ? `_${index + 1}` : ''}${outputExtension}`
}

async function allocateOutputPath(directory: string, preferredName: string, language: AppLanguage): Promise<{ outputName: string; outputPath: string }> {
  const extension = extname(preferredName)
  const stem = basename(preferredName, extension)
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const outputName = suffix === 0 ? preferredName : `${stem}_${suffix + 1}${extension}`
    const outputPath = join(directory, outputName)
    try {
      await stat(outputPath)
    } catch {
      return { outputName, outputPath }
    }
  }
  throw new Error(mainT('main.localTask.tooManyDuplicates', language))
}

export async function prepareLocalFileTask(request: string, attachmentIds: string[], language: AppLanguage = 'system'): Promise<LocalTaskPlan> {
  const targetBytes = parseTargetBytes(request)
  const files: LocalTaskFilePlan[] = []

  for (const attachmentId of attachmentIds.slice(0, 20)) {
    const filePath = getSelectedAttachmentPath(attachmentId)
    if (!filePath) {
      files.push({
        attachmentId,
        name: mainT('main.localTask.unknownAttachment', language),
        mimeType: 'application/octet-stream',
        originalSize: 0,
        supported: false,
        action: 'unsupported',
        warning: mainT('main.localTask.notLocalAttachment', language)
      })
      continue
    }
    const info = await stat(filePath)
    const extension = extname(filePath).toLowerCase()
    const isImage = imageExtensions.has(extension)
    const isPdf = extension === pdfExtension
    files.push({
      attachmentId,
      name: basename(filePath),
      mimeType: isImage ? `image/${extension === '.jpg' ? 'jpeg' : extension.slice(1)}` : 'application/octet-stream',
      originalSize: info.size,
      supported: info.size <= targetBytes || isImage || isPdf,
      action: info.size <= targetBytes ? 'copy' : isImage ? 'compress-image' : isPdf ? 'compress-pdf' : 'unsupported',
      warning:
        info.size > targetBytes && isPdf
          ? mainT('main.localTask.pdfRebuildWarning', language)
          : info.size > targetBytes && !isImage
            ? mainT('main.localTask.unsupportedWarning', language)
            : undefined
    })
  }

  if (files.length === 0) throw new Error(mainT('main.localTask.selectFile', language))
  const plan: LocalTaskPlan = {
    id: `task_${randomUUID()}`,
    request: request.trim(),
    targetBytes,
    targetLabel: mainT('main.localTask.targetLabel', language, { bytes: targetBytes.toLocaleString(), size: formatBytes(targetBytes) }),
    status: 'awaiting-approval',
    files,
    outputDirectoryName: mainT('main.localTask.outputDirectory', language),
    createdAt: Date.now()
  }
  plans.set(plan.id, plan)
  return plan
}

export async function compressImageToTarget(sourcePath: string, targetBytes: number, language: AppLanguage = 'system'): Promise<Buffer> {
  const source = await readFile(sourcePath)
  const image = await loadImage(source)
  const sourceMaxSide = Math.max(image.width, image.height)
  let maxSide = sourceMaxSide
  let bestWithinTarget: Buffer | undefined

  for (let scaleAttempt = 0; scaleAttempt < 8; scaleAttempt += 1) {
    const scale = Math.min(1, maxSide / sourceMaxSide)
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)

    let low = 0.25
    let high = 0.92
    for (let qualityAttempt = 0; qualityAttempt < 9; qualityAttempt += 1) {
      const quality = (low + high) / 2
      const output = canvas.toBuffer('image/jpeg', quality)
      if (output.length <= targetBytes && (!bestWithinTarget || output.length > bestWithinTarget.length)) {
        bestWithinTarget = output
      }
      if (output.length <= targetBytes) low = quality
      else high = quality
    }
    if (bestWithinTarget) return bestWithinTarget
    maxSide = Math.max(640, Math.floor(maxSide * 0.78))
  }
  throw new Error(mainT('main.localTask.imageTargetFailed', language))
}

export async function renderPdfToTarget(
  sourcePath: string,
  targetBytes: number,
  planId?: string,
  minimumBytes = 0,
  language: AppLanguage = 'system'
): Promise<Buffer> {
  const source = await readFile(sourcePath)
  const widths = [3600, 3200, 2800, 2400, 2100, 1800, 1500, 1250, 1050, 900, 760, 640]
  const minimumQuality = 0.5
  const maximumQuality = 0.96
  let best: { output: Buffer; width: number; quality: number; score: number } | undefined

  const buildPdf = async (pages: Array<{ data: Uint8Array; width: number; height: number }>, quality: number) => {
    const outputPdf = await PDFDocument.create()
    for (const page of pages) {
      const image = await loadImage(Buffer.from(page.data))
      const canvas = createCanvas(image.width, image.height)
      const context = canvas.getContext('2d')
      context.fillStyle = '#fff'
      context.fillRect(0, 0, image.width, image.height)
      context.drawImage(image, 0, 0)
      const jpeg = canvas.toBuffer('image/jpeg', quality)
      const embedded = await outputPdf.embedJpg(jpeg)
      const pdfPage = outputPdf.addPage([page.width, page.height])
      pdfPage.drawImage(embedded, { x: 0, y: 0, width: page.width, height: page.height })
    }
    return Buffer.from(await outputPdf.save({ useObjectStreams: true }))
  }

  for (let attempt = 0; attempt < widths.length; attempt += 1) {
    if (planId && cancelledPlans.has(planId)) throw new Error(mainT('main.localTask.cancelled', language))
    const { PDFParse } = await loadPdfParse()
    const parser = new PDFParse({ data: source })
    try {
      const screenshots = await parser.getScreenshot({
        desiredWidth: widths[attempt],
        imageBuffer: true,
        imageDataUrl: false
      })
      if (screenshots.total > 100) throw new Error(mainT('main.localTask.pdfTooLong', language))

      let candidateQuality = 0
      let candidateOutput: Buffer | undefined
      const maximumOutput = await buildPdf(screenshots.pages, maximumQuality)
      if (maximumOutput.length <= targetBytes) {
        candidateQuality = maximumQuality
        candidateOutput = maximumOutput
      } else {
        const minimumOutput = await buildPdf(screenshots.pages, minimumQuality)
        if (minimumOutput.length <= targetBytes) {
          candidateQuality = minimumQuality
          candidateOutput = minimumOutput
          let low = minimumQuality
          let high = maximumQuality
          for (let qualityAttempt = 0; qualityAttempt < 7; qualityAttempt += 1) {
            const quality = (low + high) / 2
            const output = await buildPdf(screenshots.pages, quality)
            if (output.length <= targetBytes) {
              low = quality
              if (quality > candidateQuality || (quality === candidateQuality && output.length > candidateOutput.length)) {
                candidateQuality = quality
                candidateOutput = output
              }
            } else {
              high = quality
            }
          }
        }
      }
      if (candidateOutput) {
        const score = widths[attempt] * (0.55 + candidateQuality * 0.45)
        const candidateInPreferredRange = candidateOutput.length >= minimumBytes
        const bestInPreferredRange = Boolean(best && best.output.length >= minimumBytes)
        if (
          !best ||
          (candidateInPreferredRange && !bestInPreferredRange) ||
          (candidateInPreferredRange === bestInPreferredRange && (score > best.score || (score === best.score && candidateOutput.length > best.output.length)))
        ) {
          best = { output: candidateOutput, width: widths[attempt], quality: candidateQuality, score }
        }
        const nextWidth = widths[attempt + 1]
        const nextMaximumScore = nextWidth ? nextWidth * (0.55 + maximumQuality * 0.45) : 0
        if (best && nextMaximumScore < best.score && (best.output.length >= minimumBytes || minimumBytes === 0)) break
      }
    } finally {
      await parser.destroy()
    }
  }
  if (best) return best.output
  throw new Error(mainT('main.localTask.pdfTargetFailed', language))
}

async function validateOutputBuffer(output: Buffer, action: LocalTaskFilePlan['action']): Promise<boolean> {
  if (action === 'compress-image') {
    const image = await loadImage(output)
    return image.width > 0 && image.height > 0
  }
  if (action === 'compress-pdf') {
    const pdf = await PDFDocument.load(output, { ignoreEncryption: false })
    return pdf.getPageCount() > 0
  }
  return output.length > 0
}

export async function executeLocalFileTask(
  planId: string,
  onProgress?: (progress: LocalTaskProgress) => void,
  language: AppLanguage = 'system'
): Promise<LocalTaskResult> {
  const plan = plans.get(planId)
  if (!plan) throw new Error(mainT('main.localTask.planExpired', language))
  plan.status = 'running'

  const firstPath = plan.files.map((file) => getSelectedAttachmentPath(file.attachmentId)).find(Boolean)
  if (!firstPath) throw new Error(mainT('main.localTask.noProcessableFile', language))
  const outputDirectory = join(dirname(firstPath), plan.outputDirectoryName)
  await mkdir(outputDirectory, { recursive: true })
  taskOutputDirectories.set(plan.id, outputDirectory)
  const artifacts: LocalTaskArtifact[] = []

  for (let index = 0; index < plan.files.length; index += 1) {
    if (cancelledPlans.has(planId)) break
    const file = plan.files[index]
    onProgress?.({ planId, current: index + 1, total: plan.files.length, message: mainT('main.localTask.processingFile', language, { file: file.name }) })
    const sourcePath = getSelectedAttachmentPath(file.attachmentId)
    if (!sourcePath || file.action === 'unsupported') {
      artifacts.push({ attachmentId: file.attachmentId, sourceName: file.name, originalSize: file.originalSize, success: false, verified: false, message: file.warning ?? mainT('main.localTask.cannotProcess', language) })
      continue
    }

    try {
      const output =
        file.action === 'copy'
          ? await readFile(sourcePath)
          : file.action === 'compress-pdf'
            ? await renderPdfToTarget(sourcePath, plan.targetBytes, planId, 0, language)
            : await compressImageToTarget(sourcePath, plan.targetBytes, language)
      const preferredName = uniqueOutputName(file.name, index, file.action, language)
      const { outputName, outputPath } = await allocateOutputPath(outputDirectory, preferredName, language)
      await writeFile(outputPath, output)
      const outputInfo = await stat(outputPath)
      const readable = await validateOutputBuffer(output, file.action)
      const verified = outputInfo.isFile() && outputInfo.size <= plan.targetBytes && readable
      artifacts.push({
        attachmentId: file.attachmentId,
        sourceName: file.name,
        outputName,
        originalSize: file.originalSize,
        outputSize: outputInfo.size,
        outputPath,
        success: verified,
        verified,
        message: verified
          ? mainT('main.localTask.verified', language, { bytes: plan.targetBytes.toLocaleString() })
          : mainT('main.localTask.outputTooLarge', language)
      })
    } catch (error) {
      artifacts.push({ attachmentId: file.attachmentId, sourceName: file.name, originalSize: file.originalSize, success: false, verified: false, message: error instanceof Error ? error.message : mainT('main.localTask.failed', language) })
    }
  }

  const successCount = artifacts.filter((artifact) => artifact.success).length
  const status = cancelledPlans.has(planId)
    ? 'cancelled'
    : successCount === artifacts.length
      ? 'completed'
      : successCount > 0
        ? 'partial'
        : 'failed'
  plan.status = status
  cancelledPlans.delete(planId)
  return { planId, status, targetBytes: plan.targetBytes, outputDirectory, artifacts, completedAt: Date.now() }
}

export function cancelLocalFileTask(planId: string): void {
  if (plans.get(planId)?.status === 'running') cancelledPlans.add(planId)
}

export function getLocalTaskOutputDirectory(planId: string): string | undefined {
  return taskOutputDirectories.get(planId)
}
