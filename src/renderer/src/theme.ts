/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { AppTheme } from '@shared/types'

const themeClasses = ['theme-light', 'theme-dark', 'theme-gold']
type EffectiveTheme = Exclude<AppTheme, 'auto'>

let selectedTheme: AppTheme = 'auto'
let selectedGoldEntitlement = true
let systemThemeListenerInstalled = false

function getSystemTheme(): EffectiveTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getEffectiveTheme(theme: AppTheme, goldThemeEntitled: boolean): EffectiveTheme {
  if (theme === 'auto') return getSystemTheme()
  return theme === 'gold' && !goldThemeEntitled ? 'light' : theme
}

export function applyDocumentTheme(theme: AppTheme, goldThemeEntitled: boolean): EffectiveTheme {
  selectedTheme = theme
  selectedGoldEntitlement = goldThemeEntitled
  const effectiveTheme = getEffectiveTheme(theme, goldThemeEntitled)
  const root = document.documentElement
  root.classList.remove(...themeClasses)
  root.classList.add(`theme-${effectiveTheme}`)
  root.dataset.theme = effectiveTheme
  root.style.colorScheme = effectiveTheme === 'light' ? 'light' : 'dark'
  window.dispatchEvent(new CustomEvent('gllm-theme-changed', { detail: { theme: effectiveTheme } }))

  if (!systemThemeListenerInstalled) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (selectedTheme === 'auto') applyDocumentTheme(selectedTheme, selectedGoldEntitlement)
    })
    systemThemeListenerInstalled = true
  }
  return effectiveTheme
}
