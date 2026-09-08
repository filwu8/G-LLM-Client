/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

let lastImageSaveTimestamp = 0

export function getSuggestedImageSaveName(value: unknown, extension: string, now = Date.now()): string {
  const rawName = typeof value === 'string' ? value.trim().split(/[\\/]/).at(-1) ?? '' : ''
  const nameWithoutExtension = rawName.replace(/\.(?:png|jpe?g|webp|gif)$/i, '')
  const safeName = nameWithoutExtension
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/[.\s]+$/g, '')
    .slice(0, 80)
    .trim()
  // Keep successive dialogs unique even when opened within the same millisecond.
  lastImageSaveTimestamp = Math.max(now, lastImageSaveTimestamp + 1)
  return `${safeName || 'G-LLM-image'}-${lastImageSaveTimestamp}.${extension}`
}

