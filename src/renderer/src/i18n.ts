/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { resolveAppLocale, type AppLanguage } from '@shared/i18n'
import enUS from '@shared/locales/en-US.json'
import zhCN from '@shared/locales/zh-CN.json'

export const rendererI18n = i18n.createInstance()

void rendererI18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS }
  },
  lng: resolveAppLocale('system', navigator.languages?.[0] ?? navigator.language),
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en-US'],
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false
})

export function applyRendererLanguage(language: AppLanguage): void {
  const locale = resolveAppLocale(language, navigator.languages?.[0] ?? navigator.language)
  if (rendererI18n.resolvedLanguage !== locale) void rendererI18n.changeLanguage(locale)
  document.documentElement.lang = locale
}
