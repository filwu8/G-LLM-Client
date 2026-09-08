/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function formatFileTimestamp(now: number): string {
  const date = new Date(now)
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    pad(date.getMilliseconds(), 3)
  ].join('')
}

export function getSuggestedImageSaveName(value: unknown, extension: string, now = Date.now()): string {
  const rawName = typeof value === 'string' ? value.trim().split(/[\\/]/).at(-1) ?? '' : ''
  const nameWithoutExtension = rawName.replace(/\.(?:png|jpe?g|webp|gif)$/i, '')
  const safeName = nameWithoutExtension
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/[.\s]+$/g, '')
    .slice(0, 80)
    .trim()
  const baseName = safeName.replace(/-+$/g, '') || 'G-LLM-image'
  return `${baseName}-${formatFileTimestamp(now)}.${extension}`
}
