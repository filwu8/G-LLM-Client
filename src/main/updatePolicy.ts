/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

const MAX_RELEASE_NOTES_LENGTH = 8_000
// V2.0.6 is an unsigned bridge release. The NSIS updater can run on Windows,
// while macOS stays manual because Squirrel.Mac requires a signed application.
const WINDOWS_AUTOMATIC_UPDATE_ENABLED = true
const RETRYABLE_DOWNLOAD_ERROR_PATTERN =
  /ERR_CONNECTION_(?:CLOSED|RESET)|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|network error|temporarily unavailable|\b(?:408|429|500|502|503|504)\b/i

export function supportsAutomaticUpdate(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  return WINDOWS_AUTOMATIC_UPDATE_ENABLED && isPackaged && platform === 'win32'
}

export function normalizeReleaseNotes(value: unknown): string | undefined {
  const notes = Array.isArray(value)
    ? value
        .map((item) => {
          if (typeof item === 'string') return item.trim()
          if (!item || typeof item !== 'object') return ''
          const note = Reflect.get(item, 'note')
          return typeof note === 'string' ? note.trim() : ''
        })
        .filter(Boolean)
        .join('\n\n')
    : typeof value === 'string'
      ? value.trim()
      : ''

  if (!notes) return undefined
  return notes.slice(0, MAX_RELEASE_NOTES_LENGTH)
}

export function normalizeDownloadProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

export function normalizeActiveDownloadProgress(value: number): number {
  return Math.min(99.9, normalizeDownloadProgress(value))
}

export function isRetryableUpdateDownloadError(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}${error.cause ? ` ${String(error.cause)}` : ''}`
    : String(error ?? '')
  return RETRYABLE_DOWNLOAD_ERROR_PATTERN.test(message)
}
