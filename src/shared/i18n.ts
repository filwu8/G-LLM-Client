/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export const appLanguages = ['system', 'zh-CN', 'en-US'] as const

export type AppLanguage = (typeof appLanguages)[number]
export type AppLocale = Exclude<AppLanguage, 'system'>

export const fallbackLocale: AppLocale = 'zh-CN'

export function sanitizeAppLanguage(value: unknown): AppLanguage {
  return appLanguages.includes(value as AppLanguage) ? (value as AppLanguage) : 'system'
}

export function resolveAppLocale(language: AppLanguage, systemLocale: string = fallbackLocale): AppLocale {
  if (language !== 'system') return language
  return systemLocale.toLocaleLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}
