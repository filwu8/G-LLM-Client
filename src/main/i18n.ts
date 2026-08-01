/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { app } from 'electron'
import i18next, { type TOptions } from 'i18next'

import { resolveAppLocale, type AppLanguage } from '../shared/i18n'
import enUS from '../shared/locales/en-US.json'
import zhCN from '../shared/locales/zh-CN.json'

const mainI18n = i18next.createInstance()

void mainI18n.init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS }
  },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en-US'],
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false
})

export function mainT(key: string, language: AppLanguage, options?: TOptions): string {
  const locale = resolveAppLocale(language, app.isReady() ? app.getLocale() : 'zh-CN')
  return mainI18n.t(key, { ...options, lng: locale })
}
