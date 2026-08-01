/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { rendererI18n } from './i18n'

import {
  inferModelCapabilities,
  inferModelType,
  MODEL_CAPABILITY_LABELS,
  normalizeModelCapabilities
} from '@shared/modelCapabilities'
import { supportsReasoningEffort } from '@shared/featureFlags'
import type { ApiProvider, ProviderModel, ReasoningEffort } from '@shared/types'

const reasoningEffortOptions: Array<{ value: ReasoningEffort; labelKey: string; titleKey: string }> = [
  { value: 'default', labelKey: 'modelPicker.reasoning.default', titleKey: 'modelPicker.reasoning.defaultTitle' },
  { value: 'low', labelKey: 'modelPicker.reasoning.low', titleKey: 'modelPicker.reasoning.lowTitle' },
  { value: 'medium', labelKey: 'modelPicker.reasoning.medium', titleKey: 'modelPicker.reasoning.mediumTitle' },
  { value: 'high', labelKey: 'modelPicker.reasoning.high', titleKey: 'modelPicker.reasoning.highTitle' }
]

const modelNameCollator = new Intl.Collator(['zh-CN', 'en'], {
  numeric: true,
  sensitivity: 'base'
})

const modelFamilyPriority = [
  'gpt',
  'claude',
  'gemini',
  'qwen',
  'deepseek',
  'glm',
  'doubao',
  'kimi',
  'moonshot',
  'grok',
  'llama',
  'mistral',
  'codex',
  'sonar',
  'flux',
  'dall',
  'imagen'
]

export function getModelOptions(provider: ApiProvider, selectedModel = provider.defaultModel): ProviderModel[] {
  const models = provider.models.some((model) => model.id === selectedModel)
    ? provider.models
    : [
        {
          id: selectedModel,
          name: selectedModel,
          capabilities: inferModelCapabilities(selectedModel),
          type: inferModelType(selectedModel)
        },
        ...provider.models
      ]

  return models
    .filter((model) => model.id)
    .map((model) => ({
      ...model,
      capabilities: normalizeModelCapabilities(model),
      type: model.type ?? inferModelType(model.id)
    }))
    .sort(compareProviderModels)
}

function getModelName(model: ProviderModel): string {
  return model.name?.trim() || model.id
}

function getModelTitle(model: ProviderModel): string {
  return model.name && model.name !== model.id ? model.name : model.id
}

function getModelSubtitle(model: ProviderModel): string {
  return model.name && model.name !== model.id ? model.id : model.ownedBy || ''
}

function getModelSortText(model: ProviderModel): string {
  const displayName = getModelName(model)
  const id = model.id
  return `${displayName} ${id}`
    .toLocaleLowerCase()
    .replace(/_+/g, '-')
    .replace(/\s+/g, '-')
}

function getModelFamilyKey(model: ProviderModel): string {
  const sortText = getModelSortText(model)
  const family = modelFamilyPriority.find((key) => new RegExp(`(^|[-/])${key}(?=$|[-/]|\\d)`).test(sortText))
  if (family) return family

  const leafName = sortText.split(/[/-]/).at(-1) || sortText
  return leafName.match(/[a-z]+/)?.[0] ?? leafName
}

function getModelFamilyRank(model: ProviderModel): number {
  const familyIndex = modelFamilyPriority.indexOf(getModelFamilyKey(model))
  return familyIndex >= 0 ? familyIndex : modelFamilyPriority.length
}

function getModelVersionParts(model: ProviderModel): number[] {
  const sortText = getModelSortText(model)
  const familyKey = getModelFamilyKey(model)
  const familyIndex = sortText.indexOf(familyKey)
  const versionText = familyIndex >= 0 ? sortText.slice(familyIndex + familyKey.length) : sortText
  const match = versionText.match(/\d+(?:[.-]\d+)*/)
  if (!match) return []
  return match[0].split(/[.-]/).map((part) => Number(part)).filter((part) => Number.isFinite(part))
}

function compareModelVersionsDescending(first: ProviderModel, second: ProviderModel): number {
  const firstParts = getModelVersionParts(first)
  const secondParts = getModelVersionParts(second)
  const maxLength = Math.max(firstParts.length, secondParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const firstPart = firstParts[index] ?? -1
    const secondPart = secondParts[index] ?? -1
    if (firstPart !== secondPart) return secondPart - firstPart
  }

  return 0
}

function getModelVariantRank(model: ProviderModel): number {
  const sortText = getModelSortText(model)
  if (/\bcodex\b/.test(sortText) || /(^|-)codex($|-)/.test(sortText)) return 2
  if (/embedding|rerank|audio|tts|whisper/.test(sortText)) return 3
  return 0
}

function compareProviderModels(first: ProviderModel, second: ProviderModel): number {
  const firstFamily = getModelFamilyKey(first)
  const secondFamily = getModelFamilyKey(second)

  return (
    getModelFamilyRank(first) - getModelFamilyRank(second) ||
    modelNameCollator.compare(firstFamily, secondFamily) ||
    compareModelVersionsDescending(first, second) ||
    getModelVariantRank(first) - getModelVariantRank(second) ||
    modelNameCollator.compare(getModelName(first), getModelName(second)) ||
    modelNameCollator.compare(first.id, second.id)
  )
}

function getModelSearchText(model: ProviderModel): string {
  return [
    model.id,
    model.name,
    model.ownedBy,
    model.type,
    ...normalizeModelCapabilities(model),
    ...normalizeModelCapabilities(model).map((capability) => MODEL_CAPABILITY_LABELS[capability])
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
}

export function getModelDisplayLabel(model: ProviderModel): string {
  const name = model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id
  const capabilities = normalizeModelCapabilities(model)
    .map((capability) => rendererI18n.t(`modelPicker.capability.${capability}`))
    .join(' / ')
  return `${name} · ${capabilities}`
}

export function ModelCapabilityBadges({ model }: { model: ProviderModel }) {
  return (
    <>
      {normalizeModelCapabilities(model).map((capability) => (
        <span key={capability} className={`model-capability-badge type-${capability}`}>
          {rendererI18n.t(`modelPicker.capability.${capability}`)}
        </span>
      ))}
    </>
  )
}

function ModelPickerList({
  models,
  selectedModelId,
  onSelect,
  reasoningEffort,
  onReasoningEffortChange,
  onModelReasoningChange,
  emptyLabel
}: {
  models: ProviderModel[]
  selectedModelId: string
  onSelect: (modelId: string) => void
  reasoningEffort?: ReasoningEffort
  onReasoningEffortChange?: (effort: ReasoningEffort) => void
  onModelReasoningChange?: (modelId: string, effort: ReasoningEffort) => void
  emptyLabel?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="conversation-model-list" role="listbox" aria-label={t('modelPicker.model')}>
      {models.map((model) => {
        const subtitle = getModelSubtitle(model)
        const selected = model.id === selectedModelId
        const showReasoningOptions = Boolean(
          supportsReasoningEffort(model) && (onModelReasoningChange || (selected && onReasoningEffortChange))
        )
        return (
          <div
            key={model.id}
            aria-selected={selected}
            className={`conversation-model-option ${selected ? 'active' : ''} ${showReasoningOptions ? 'has-reasoning-options' : ''}`.trim()}
            onClick={() => onSelect(model.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(model.id)
              }
            }}
            role="option"
            tabIndex={0}
            title={getModelDisplayLabel(model)}
          >
            <span className="conversation-model-info">
              <strong>{getModelTitle(model)}</strong>
              {subtitle && <small>{subtitle}</small>}
            </span>
            {showReasoningOptions && (
              <span className="model-inline-reasoning" aria-label={t('modelPicker.reasoningEffort')}>
                {reasoningEffortOptions.map((option) => (
                  <button
                    key={option.value}
                    aria-pressed={(reasoningEffort ?? 'default') === option.value}
                    className={(reasoningEffort ?? 'default') === option.value ? 'active' : ''}
                    title={t(option.titleKey)}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (onModelReasoningChange) {
                        onModelReasoningChange(model.id, option.value)
                      } else {
                        onReasoningEffortChange?.(option.value)
                      }
                    }}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </span>
            )}
            <span className="model-capability-list">
              <ModelCapabilityBadges model={model} />
            </span>
          </div>
        )
      })}
      {models.length === 0 && <div className="conversation-model-empty">{emptyLabel ?? t('modelPicker.empty')}</div>}
    </div>
  )
}

export function ModelPickerMenu({
  provider,
  value,
  onChange,
  variant = 'expanded',
  className = '',
  placement = 'bottom',
  disabled = false,
  showTriggerCapabilities = true,
  reasoningEffort,
  onReasoningEffortChange,
  onModelReasoningChange
}: {
  provider: ApiProvider
  value: string
  onChange: (modelId: string) => void
  variant?: 'expanded' | 'dropdown'
  className?: string
  placement?: 'bottom' | 'top'
  disabled?: boolean
  showTriggerCapabilities?: boolean
  reasoningEffort?: ReasoningEffort
  onReasoningEffortChange?: (effort: ReasoningEffort) => void
  onModelReasoningChange?: (modelId: string, effort: ReasoningEffort) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modelOptions = useMemo(() => getModelOptions(provider, value), [provider, value])
  const selectedModel = modelOptions.find((model) => model.id === value) ?? null
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleModelOptions = normalizedQuery
    ? modelOptions.filter((model) => getModelSearchText(model).includes(normalizedQuery))
    : modelOptions
  const selectedReasoningEffort = reasoningEffort ?? 'default'
  const selectedReasoningOption = reasoningEffortOptions.find((option) => option.value === selectedReasoningEffort)
    ?? reasoningEffortOptions[0]
  const showReasoningValue = Boolean(
    (onReasoningEffortChange || onModelReasoningChange) && supportsReasoningEffort(selectedModel)
  )

  useEffect(() => {
    setQuery('')
    setOpen(false)
  }, [provider.id])

  useEffect(() => {
    if (variant !== 'dropdown' || !open) return

    function closeOnOutsideClick(event: MouseEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    window.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, variant])

  function selectModel(modelId: string) {
    onChange(modelId)
    if (variant === 'dropdown') {
      setOpen(false)
      setQuery('')
    }
  }

  const searchField = (
    <label className="model-search-field">
      <Search size={16} />
      <input
        aria-label={t('modelPicker.searchLabel')}
        placeholder={t('modelPicker.searchPlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
        }}
      />
    </label>
  )

  if (variant === 'dropdown') {
    const subtitle = selectedModel ? getModelSubtitle(selectedModel) : ''

    return (
      <div
        className={`model-picker-dropdown placement-${placement} ${className}`.trim()}
        ref={dropdownRef}
      >
        <button
          aria-expanded={open}
          className="model-dropdown-trigger"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          title={selectedModel
            ? `${getModelDisplayLabel(selectedModel)}${showReasoningValue ? ` · ${t('modelPicker.reasoningEffort')}: ${t(selectedReasoningOption.labelKey)}` : ''}`
            : t('modelPicker.select')}
          type="button"
        >
          <span className="model-dropdown-current">
            <strong>
              {selectedModel ? getModelTitle(selectedModel) : value || t('modelPicker.select')}
              {showReasoningValue && <span className="model-current-reasoning"> {t(selectedReasoningOption.labelKey)}</span>}
            </strong>
            {subtitle && <small>{subtitle}</small>}
          </span>
          {selectedModel && showTriggerCapabilities && (
            <span className="model-capability-list model-dropdown-capabilities">
              <ModelCapabilityBadges model={selectedModel} />
            </span>
          )}
          <ChevronDown size={17} />
        </button>
        {open && !disabled && (
          <div className="model-dropdown-popover">
            {searchField}
            <ModelPickerList
              models={visibleModelOptions}
              selectedModelId={value}
              reasoningEffort={selectedReasoningEffort}
              onSelect={selectModel}
              onReasoningEffortChange={onReasoningEffortChange
                ? (effort) => {
                    onReasoningEffortChange(effort)
                    setOpen(false)
                  }
                : undefined}
              onModelReasoningChange={onModelReasoningChange
                ? (modelId, effort) => {
                    onModelReasoningChange(modelId, effort)
                    setOpen(false)
                  }
                : undefined}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="conversation-model-picker">
      <div className="conversation-model-picker-head">
        <span>{t('modelPicker.model')}</span>
        <small>
          {selectedModel ? t('modelPicker.currentModel', { model: getModelTitle(selectedModel) }) : t('modelPicker.select')} · {visibleModelOptions.length}/{modelOptions.length}
        </small>
      </div>
      {searchField}
      <ModelPickerList models={visibleModelOptions} selectedModelId={value} onSelect={selectModel} />
    </div>
  )
}
