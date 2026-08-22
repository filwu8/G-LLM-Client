/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { spawn } from 'node:child_process'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { clipboard, shell, systemPreferences } from 'electron'

import type { PreparedAttachment } from '../shared/types'
import { prepareImageDataUrlForVision } from './attachments'
import {
  getMacScreenCapturePermissionError,
  getMacScreenshotArguments,
  getScreenshotBackend,
  type ScreenMediaAccessStatus
} from './screenshotPlatform'

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

interface MacCaptureResult {
  completed: boolean
  stderr: string
}

function runMacInteractiveCapture(outputPath: string): Promise<MacCaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/sbin/screencapture', getMacScreenshotArguments(outputPath), {
      stdio: ['ignore', 'ignore', 'pipe']
    })
    let settled = false
    let stderr = ''
    let timedOut = false

    const finish = (result: MacCaptureResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, screenshotTimeoutMs)

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString('utf8').slice(0, 4_096 - stderr.length)
    })
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once('close', (code) => {
      finish({ completed: !timedOut && code === 0, stderr })
    })
  })
}

function createMacScreenshotPath(): string {
  return join(tmpdir(), `gllm-screenshot-${Date.now()}-${Math.random().toString(16).slice(2)}.png`)
}

async function captureMacScreenshot(): Promise<string> {
  const screenshotPath = createMacScreenshotPath()

  try {
    const result = await runMacInteractiveCapture(screenshotPath)
    if (!result.completed) {
      const status = systemPreferences.getMediaAccessStatus('screen') as ScreenMediaAccessStatus
      const permissionError = getMacScreenCapturePermissionError(status, result.stderr)
      if (permissionError) throw new Error(permissionError)
      return ''
    }

    const buffer = await readFile(screenshotPath).catch(() => null)
    if (!buffer?.length) {
      const status = systemPreferences.getMediaAccessStatus('screen') as ScreenMediaAccessStatus
      const permissionError = getMacScreenCapturePermissionError(status, result.stderr)
      if (permissionError) throw new Error(permissionError)
      return ''
    }
    return `data:image/png;base64,${buffer.toString('base64')}`
  } finally {
    await unlink(screenshotPath).catch(() => undefined)
  }
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
  const backend = getScreenshotBackend(process.platform)
  let dataUrl = ''

  if (backend === 'windows-screenclip') {
    const previousDataUrl = readClipboardImageDataUrl()
    await shell.openExternal('ms-screenclip:')
    dataUrl = await waitForNewClipboardImage(previousDataUrl)
  } else if (backend === 'macos-screencapture') {
    dataUrl = await captureMacScreenshot()
  } else {
    throw new Error('当前系统暂不支持截图，请通过附件上传图片。')
  }

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
