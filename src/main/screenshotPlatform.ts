/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export type ScreenshotBackend = 'windows-screenclip' | 'macos-screencapture' | 'unsupported'
export type ScreenMediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'

export function getScreenshotBackend(platform: NodeJS.Platform): ScreenshotBackend {
  if (platform === 'win32') return 'windows-screenclip'
  if (platform === 'darwin') return 'macos-screencapture'
  return 'unsupported'
}

export function getMacScreenshotArguments(outputPath: string): string[] {
  return ['-i', '-s', '-x', '-t', 'png', outputPath]
}

export function getMacScreenCapturePermissionError(
  status: ScreenMediaAccessStatus,
  stderr: string
): string | null {
  const normalizedError = stderr.toLowerCase()
  const permissionDenied = status === 'denied'
    || status === 'restricted'
    || normalizedError.includes('permission')
    || normalizedError.includes('not authorized')
    || normalizedError.includes('could not create image')

  if (!permissionDenied) return null
  return 'G-LLM 没有屏幕录制权限。请前往“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”允许 G-LLM Client（开发版显示为 Electron），然后重启应用。'
}
