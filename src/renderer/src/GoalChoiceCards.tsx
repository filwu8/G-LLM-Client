/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { GoalChoice } from '@shared/types'

interface GoalChoiceCardsProps {
  choices: GoalChoice[]
  disabled?: boolean
  /** Called with the chosen option(s) for a single choice card. */
  onAnswer: (choice: GoalChoice, selection: string[]) => void
  /** Called when the user wants to type a free-form answer instead. */
  onCustom: () => void
}

/**
 * Renders goal-mode clarifying questions that have a small set of concrete
 * answers as tappable option cards above the composer, so the user can answer
 * in one click instead of typing.
 */
export function GoalChoiceCards({ choices, disabled = false, onAnswer, onCustom }: GoalChoiceCardsProps) {
  const { t } = useTranslation()
  const [selectionMap, setSelectionMap] = useState<Record<number, string[]>>({})
  const keys = useMemo(() => choices.map((choice, index) => `${index}:${choice.text}`), [choices])

  function toggle(index: number, option: string) {
    setSelectionMap((current) => {
      const selected = current[index] ?? []
      const next = selected.includes(option)
        ? selected.filter((item) => item !== option)
        : [...selected, option]
      return { ...current, [index]: next }
    })
  }

  function clear(index: number) {
    setSelectionMap((current) => ({ ...current, [index]: [] }))
  }

  return (
    <div className="goal-choice-list">
      {choices.map((choice, index) => {
        const selected = selectionMap[index] ?? []
        const hasCustom = choice.allowsCustom !== false
        return (
          <div className="goal-choice-card" key={keys[index]}>
            <p className="goal-choice-question">
              {choice.text}
              {choice.multiple && <span className="goal-choice-multi">{t('goalMode.choiceMultiHint')}</span>}
            </p>
            <div className="goal-choice-options">
              {choice.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`goal-choice-option${selected.includes(option) ? ' is-selected' : ''}`}
                  disabled={disabled}
                  onClick={() => {
                    if (choice.multiple) toggle(index, option)
                    else onAnswer(choice, [option])
                  }}
                >
                  {option}
                </button>
              ))}
              {hasCustom && (
                <button type="button" className="goal-choice-option is-custom" disabled={disabled} onClick={onCustom}>
                  {t('goalMode.choiceCustom')}
                </button>
              )}
            </div>
            {choice.multiple && selected.length > 0 && (
              <button
                type="button"
                className="goal-choice-send"
                disabled={disabled}
                onClick={() => {
                  onAnswer(choice, selected)
                  clear(index)
                }}
              >
                {t('goalMode.choiceSend')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
