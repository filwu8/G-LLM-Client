/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

const MAX_RELEASE_NOTES_LENGTH = 8_000
// V2.0.3 is distributed without platform signing. Keep automatic installation
// disabled until Windows Authenticode and macOS Developer ID/notarization are configured.
const SIGNED_AUTOMATIC_UPDATE_ENABLED = false

export function supportsAutomaticUpdate(isPackaged: boolean, platform: NodeJS.Platform): boolean {
  return SIGNED_AUTOMATIC_UPDATE_ENABLED && isPackaged && (platform === 'win32' || platform === 'darwin')
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
