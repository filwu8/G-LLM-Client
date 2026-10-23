/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import type { AppSettings } from '../shared/types'

export const assistantSettingKeys = ['language', 'theme', 'timeZone', 'webSearchMode', 'temperature', 'enableTemperature', 'maxTokens', 'enableMaxTokens', 'messageSendShortcut', 'floatingMascotVisible', 'floatingMascotHints'] as const
export function validateAssistantSettings(value: unknown): Partial<AppSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provide a settings object')
  const patch = value as Record<string, unknown>
  if (!Object.keys(patch).length) throw new Error('No settings to change')
  for (const [key, item] of Object.entries(patch)) {
    if (!(assistantSettingKeys as readonly string[]).includes(key)) throw new Error(`Setting cannot be changed by the assistant: ${key}`)
    if (['enableTemperature', 'enableMaxTokens', 'floatingMascotVisible', 'floatingMascotHints'].includes(key)) {
      if (typeof item !== 'boolean') throw new Error(`Expected boolean: ${key}`)
    } else if (key === 'temperature') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 2) throw new Error('Temperature must be between 0 and 2')
    } else if (key === 'maxTokens') {
      if (typeof item !== 'number' || !Number.isInteger(item) || item < 1 || item > 131072) throw new Error('Max tokens must be between 1 and 131072')
    } else if (key === 'timeZone') {
      if (typeof item !== 'string') throw new Error('Invalid time zone')
      if (item !== 'system') new Intl.DateTimeFormat('en', { timeZone: item }).format()
    } else {
      const allowed: Record<string, string[]> = { language: ['system', 'zh-CN', 'en-US'], theme: ['auto', 'light', 'dark'], webSearchMode: ['off', 'auto', 'on'], messageSendShortcut: ['enter', 'ctrl-enter'] }
      if (!allowed[key]?.includes(String(item))) throw new Error(`Unsupported value for ${key}`)
    }
  }
  return { ...patch } as Partial<AppSettings>
}
