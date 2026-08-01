/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { GLLM_ASSISTANT_PRESETS, type AssistantPreset } from '@shared/assistantPresets'
import enUSAssistantPresets from '@shared/locales/assistant-presets/en-US.json'
import type { Assistant } from '@shared/types'

import { rendererI18n } from './i18n'

const localizedBuiltInAssistantIds = new Set(['general', 'document', 'legal', 'code', 'business', 'teacher'])
const presetCategoryKeys: Record<string, string> = {
  '精选': 'featured',
  '经营管理': 'business',
  '金融投资': 'finance',
  '内容创作': 'content',
  '办公效率': 'productivity',
  '建筑工程': 'construction',
  '技术研发': 'technology',
  '法律财税': 'legalFinance',
  '学习教育': 'education',
  '健康生活': 'health',
  '创意设计': 'design',
  '个人成长': 'growth'
}

type EnglishPresetId = keyof typeof enUSAssistantPresets

export function localizeAssistant(assistant: Assistant): Assistant {
  if (!assistant.builtIn || !localizedBuiltInAssistantIds.has(assistant.id)) return assistant

  const prefix = `assistants.${assistant.id}`
  const starterPrompts = rendererI18n.t(`${prefix}.starters`, { returnObjects: true })

  return {
    ...assistant,
    name: rendererI18n.t(`${prefix}.name`),
    title: rendererI18n.t(`${prefix}.title`),
    starterPrompts: Array.isArray(starterPrompts) ? starterPrompts.map(String) : assistant.starterPrompts
  }
}

export function localizeAssistantPreset(preset: AssistantPreset): AssistantPreset {
  if (rendererI18n.resolvedLanguage !== 'en-US') return preset

  const metadata = enUSAssistantPresets[preset.id as EnglishPresetId]
  if (!metadata) return preset

  return {
    ...preset,
    ...metadata,
    tone: rendererI18n.t('assistantPresets.defaultTone'),
    keywords: [...preset.keywords, metadata.name, metadata.title, metadata.description],
    starterPrompts: [
      rendererI18n.t('assistantPresets.starters.help', { name: metadata.name }),
      rendererI18n.t('assistantPresets.starters.context', { title: metadata.title }),
      rendererI18n.t('assistantPresets.starters.plan', { name: metadata.name })
    ]
  }
}

export function localizeAssistantPresetCategory(category: string): string {
  const key = presetCategoryKeys[category]
  return key ? rendererI18n.t(`assistantPresets.categories.${key}`) : category
}

export function searchLocalizedAssistantPresets(keyword: string, category: string): AssistantPreset[] {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()

  return GLLM_ASSISTANT_PRESETS
    .filter((preset) => !category || (category === '精选' ? preset.featured : preset.category === category))
    .map(localizeAssistantPreset)
    .filter((preset) => {
      if (!normalizedKeyword) return true
      return [preset.name, preset.title, preset.description, ...preset.keywords]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedKeyword)
    })
}

export function findLocalizedAssistantPreset(keyword: string): AssistantPreset | undefined {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  if (!normalizedKeyword) return undefined

  return GLLM_ASSISTANT_PRESETS
    .map(localizeAssistantPreset)
    .find((preset) => [preset.id, preset.name, ...preset.keywords].some((value) => value.toLocaleLowerCase() === normalizedKeyword))
}
