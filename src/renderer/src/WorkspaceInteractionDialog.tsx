/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { Check, CircleHelp, Clock3, KeyRound, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkspaceInteractionRequest, WorkspaceInteractionResponse } from '@shared/types'

interface WorkspaceInteractionDialogProps {
  request: WorkspaceInteractionRequest
  busy?: boolean
  /**
   * `modal` centres the question over the conversation; `inline` renders the
   * same controls at the bottom of the chat, next to the composer, where the
   * conversation is already looking. A modal interrupts typing and hides the
   * messages the question is about, which is the wrong trade-off for a question
   * that belongs to the current run.
   */
  variant?: 'modal' | 'inline'
  onRespond: (response: WorkspaceInteractionResponse) => void
  onCancel: () => void
}

/**
 * Native UI for an agent question. Single-choice answers submit immediately;
 * multiple choice collects a set; text/confirm render the matching control.
 * The dialog never exposes raw tool arguments or JSON to the user.
 */
export function WorkspaceInteractionDialog({ request, busy = false, variant = 'modal', onRespond, onCancel }: WorkspaceInteractionDialogProps) {
  const { t, i18n } = useTranslation()
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN'

  useEffect(() => {
    setSelected([])
    setCustom('')
    setShowCustom(false)
  }, [request.id])

  const expired = Boolean(request.expiresAt && request.expiresAt < Date.now())
  const multiple = request.selection === 'multiple'
  const textOnly = request.selection === 'text'
  const confirm = request.selection === 'confirm'
  const disabled = busy || expired

  const submit = (ids: string[], customText?: string) => {
    if (disabled) return
    onRespond({
      id: request.id,
      selectedIds: ids,
      ...(customText ? { customText } : {}),
      cancelled: false,
      answeredAt: Date.now()
    })
  }

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const createdLabel = new Date(request.createdAt).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })

  const content = (
    <>
        <header>
          <div>
            <span id="workspace-interaction-title">
              {request.kind === 'auth' ? <KeyRound size={17} /> : <CircleHelp size={17} />}
              {request.title}
            </span>
            <small><Clock3 size={11} />{createdLabel}</small>
          </div>
        </header>
        {/*
          The scroll lives here, not on the card, so the actions at the bottom
          stay put. Scrolling the whole card pushed the submit button out of
          sight, and a sticky footer covered the options it floated over.
        */}
        <div className="interaction-body">
          {request.description && <p className="interaction-description">{request.description}</p>}
          {request.context && <pre className="workspace-code-preview"><code>{request.context}</code></pre>}

          {expired ? (
            <p className="interaction-expired">{t('interaction.expired')}</p>
          ) : textOnly ? (
            <label className="interaction-text">
              <span>{t('interaction.textHint')}</span>
              <textarea
                autoFocus
                disabled={disabled}
                onChange={(event) => setCustom(event.target.value)}
                placeholder={t('interaction.textPlaceholder')}
                rows={3}
                value={custom}
              />
            </label>
          ) : confirm ? (
            <p className="interaction-description">{t('interaction.confirmHint')}</p>
          ) : (
            <div className="interaction-options" role={multiple ? 'group' : 'radiogroup'}>
              {request.options.map((option) => {
                const active = selected.includes(option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`interaction-option${active ? ' is-selected' : ''}${option.recommended ? ' is-recommended' : ''}`}
                    // The inline card keeps every option on one line and truncates
                    // the description, so the full text has to stay reachable.
                    title={option.description ? `${option.label} — ${option.description}` : option.label}
                    aria-checked={active}
                    role={multiple ? 'checkbox' : 'radio'}
                    disabled={disabled}
                    onClick={() => {
                      if (disabled) return
                      if (multiple) { toggle(option.id); return }
                      submit([option.id])
                    }}
                  >
                    <span className="interaction-option-head">
                      <strong>{option.label}</strong>
                      {option.recommended && <em><Sparkles size={10} />{t('interaction.recommended')}</em>}
                      {active && <Check size={13} />}
                    </span>
                    {option.description && <small>{option.description}</small>}
                  </button>
                )
              })}
              {request.allowCustom && !showCustom && (
                <button type="button" className="interaction-option interaction-custom-toggle" disabled={disabled} title={t('interaction.customHint')} onClick={() => setShowCustom(true)}>
                  <span className="interaction-option-head"><strong>{t('interaction.custom')}</strong></span>
                  <small>{t('interaction.customHint')}</small>
                </button>
              )}
              {showCustom && (
                <label className="interaction-text">
                  <textarea
                    autoFocus
                    disabled={disabled}
                    onChange={(event) => setCustom(event.target.value)}
                    placeholder={t('interaction.textPlaceholder')}
                    rows={2}
                    value={custom}
                  />
                </label>
              )}
            </div>
          )}
        </div>

        <footer>
          {request.allowSkip && !confirm && (
            <button className="secondary-action" type="button" disabled={busy} onClick={onCancel}>
              {t('interaction.skip')}
            </button>
          )}
          {!textOnly && !confirm && (multiple || showCustom) && (
            <button
              className="primary-action"
              type="button"
              disabled={disabled || (selected.length === 0 && !custom.trim())}
              onClick={() => submit(selected, showCustom ? custom.trim() : undefined)}
            >
              {t(showCustom && selected.length === 0 ? 'interaction.submitCustom' : 'interaction.submit')}
            </button>
          )}
          {textOnly && (
            <button
              className="primary-action"
              type="button"
              disabled={disabled || !custom.trim()}
              onClick={() => submit([], custom.trim())}
            >
              {t('interaction.submit')}
            </button>
          )}
          {confirm && (
            <>
              <button className="secondary-action" type="button" disabled={busy} onClick={onCancel}>
                {t('interaction.confirmCancel')}
              </button>
              <button className="primary-action" type="button" disabled={disabled} onClick={() => submit([])}>
                {t('interaction.confirmContinue')}
              </button>
            </>
          )}
        </footer>
    </>
  )

  if (variant === 'inline') {
    return (
      <section className="workspace-interaction-inline" role="group" aria-labelledby="workspace-interaction-title">
        {content}
      </section>
    )
  }

  return (
    <div className="assistant-modal-backdrop workspace-approval-backdrop">
      <section aria-modal="true" className="workspace-approval-dialog workspace-interaction-dialog" role="dialog" aria-labelledby="workspace-interaction-title">
        {content}
      </section>
    </div>
  )
}
