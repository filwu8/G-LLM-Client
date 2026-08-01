/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { clipboard, shell } from 'electron'

import type { PreparedAttachment } from '../shared/types'
import { prepareImageDataUrlForVision } from './attachments'

const screenshotTimeoutMs = 45_000
const pollIntervalMs = 350

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getScreenshotName(): string {
  const now = new Date()
  const pad = (value: number) => `${value}`.padStart(2, '0')
  return `截图_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`
}

function estimateDataUrlSize(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? ''
  return Math.round(base64.length * 0.75)
}

function readClipboardImageDataUrl(): string {
  const image = clipboard.readImage()
  return image.isEmpty() ? '' : image.toDataURL()
}

async function waitForNewClipboardImage(previousDataUrl: string): Promise<string> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < screenshotTimeoutMs) {
    const dataUrl = readClipboardImageDataUrl()
    if (dataUrl && dataUrl !== previousDataUrl) return dataUrl
    await sleep(pollIntervalMs)
  }

  return ''
}

export async function captureScreenshot(): Promise<PreparedAttachment | null> {
  if (process.platform !== 'win32') {
    throw new Error('当前版本截图功能先支持 Windows。其他系统请通过附件上传图片。')
  }

  const previousDataUrl = readClipboardImageDataUrl()
  await shell.openExternal('ms-screenclip:')
  const dataUrl = await waitForNewClipboardImage(previousDataUrl)

  if (!dataUrl) return null
  const image = await prepareImageDataUrlForVision(dataUrl, 'image/png')

  return {
    id: createAttachmentId(),
    name: getScreenshotName(),
    mimeType: image?.mimeType ?? 'image/png',
    size: image?.size ?? estimateDataUrlSize(dataUrl),
    kind: 'image',
    dataUrl: image?.dataUrl ?? dataUrl
  }
}
