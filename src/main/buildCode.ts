/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * The About panel renders `V<version>(<build code>)`. The code is only worth
 * showing if it names the build, and it is only acceptable if it cannot be
 * invented.
 *
 * Reading it from the filesystem does not survive packaging: inside app.asar
 * Electron fabricates the mtime of `statSync(__filename)` from the current
 * clock, so the value tracked the launch time instead of the build time, and an
 * install left running for two days looked freshly rebuilt. The previous code
 * answered that with `new Date()`, which made the label confidently wrong.
 *
 * Order: an operator override wins, then the constant injected at bundle time,
 * then the mtime of this file - meaningful only when it is a real file. When
 * none applies the result is empty and the label degrades to a bare version.
 */

export interface BuildCodeSources {
  readonly envCode?: string
  readonly injectedCode?: string
  readonly isPackaged: boolean
  readonly scriptMtimeMs?: number
}

export function formatBuildCode(date: Date): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  ]

  return parts.map((part) => String(part).padStart(2, '0')).join('')
}

export function resolveBuildCode(sources: BuildCodeSources): string {
  const envCode = sources.envCode?.trim()
  if (envCode) return envCode

  // A packaged main process has no trustworthy file time to fall back on, so a
  // missing injection yields no code rather than a guess.
  if (sources.isPackaged) return sources.injectedCode?.trim() ?? ''

  if (typeof sources.scriptMtimeMs === 'number' && Number.isFinite(sources.scriptMtimeMs)) {
    return formatBuildCode(new Date(sources.scriptMtimeMs))
  }

  return ''
}
