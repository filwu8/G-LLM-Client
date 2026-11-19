/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { Check, Hand, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { AgentPermissionMode } from '@shared/types'

const options: Array<{
  mode: AgentPermissionMode
  icon: typeof ShieldCheck
  labelKey: string
  shortKey: string
  descriptionKey: string
}> = [
  {
    mode: 'ask',
    icon: Hand,
    labelKey: 'agentPermission.ask',
    shortKey: 'agentPermission.askShort',
    descriptionKey: 'agentPermission.askDescription'
  },
  {
    mode: 'auto',
    icon: ShieldCheck,
    labelKey: 'agentPermission.auto',
    shortKey: 'agentPermission.autoShort',
    descriptionKey: 'agentPermission.autoDescription'
  },
  {
    mode: 'full',
    icon: ShieldAlert,
    labelKey: 'agentPermission.full',
    shortKey: 'agentPermission.fullShort',
    descriptionKey: 'agentPermission.fullDescription'
  }
]

export function AgentPermissionPicker({
  mode,
  acknowledged,
  disabled = false,
  onChange,
  onAcknowledge
}: {
  mode: AgentPermissionMode
  acknowledged: boolean
  disabled?: boolean
  onChange: (mode: AgentPermissionMode) => void
  onAcknowledge: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pendingFull, setPendingFull] = useState(false)
  const [riskAccepted, setRiskAccepted] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>()
  const pickerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.mode === mode) ?? options[0]
  const SelectedIcon = selected.icon

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      // The menu is portalled to <body>, so it is not inside pickerRef.
      if (pickerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeOnResize = () => setOpen(false)

    window.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnResize)
    return () => {
      window.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnResize)
    }
  }, [open])

  useEffect(() => {
    if (!pendingFull) setRiskAccepted(false)
  }, [pendingFull])

  function toggleMenu() {
    if (open) {
      setOpen(false)
      return
    }

    const triggerRect = pickerRef.current?.getBoundingClientRect()
    if (triggerRect) {
      const viewportPadding = 12
      const width = Math.min(320, window.innerWidth - viewportPadding * 2)
      const left = Math.max(
        viewportPadding,
        Math.min(triggerRect.left, window.innerWidth - width - viewportPadding)
      )
      setMenuStyle({ bottom: window.innerHeight - triggerRect.top + 9, left, width })
    }
    setOpen(true)
  }

  function choose(next: AgentPermissionMode) {
    setOpen(false)
    if (next === mode) return
    // Full access is the only irreversible-feeling step: confirm it once.
    if (next === 'full' && !acknowledged) {
      setPendingFull(true)
      return
    }
    onChange(next)
  }

  return (
    <div className={`agent-permission-picker mode-${mode}`} ref={pickerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${t('agentPermission.label')}: ${t(selected.labelKey)}`}
        className="agent-permission-trigger"
        disabled={disabled}
        title={`${t('agentPermission.label')}: ${t(selected.labelKey)} · ${t(selected.descriptionKey)}`}
        type="button"
        onClick={toggleMenu}
      >
        <SelectedIcon size={16} />
      </button>
      {createPortal(
        <>
          {open && !disabled && (
            <div className="agent-permission-menu" ref={menuRef} role="menu" style={menuStyle}>
              {options.map((option) => {
                const Icon = option.icon
                return (
                  <button
                    key={option.mode}
                    aria-checked={mode === option.mode}
                    className={`agent-permission-option mode-${option.mode}${mode === option.mode ? ' selected' : ''}`}
                    role="menuitemradio"
                    type="button"
                    onClick={() => choose(option.mode)}
                  >
                    <span className="agent-permission-option-icon"><Icon size={15} /></span>
                    <span className="agent-permission-option-copy">
                      <strong>{t(option.labelKey)}</strong>
                      <small>{t(option.descriptionKey)}</small>
                    </span>
                    <span className="agent-permission-option-check">{mode === option.mode && <Check size={15} />}</span>
                  </button>
                )
              })}
              <p className="agent-permission-hint">{t('agentPermission.hint')}</p>
            </div>
          )}
          {pendingFull && (
            <div
              className="assistant-modal-backdrop workspace-approval-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setPendingFull(false)
              }}
            >
              <section aria-modal="true" className="workspace-approval-dialog agent-permission-dialog" role="alertdialog">
                <header>
                  <div>
                    <span><TriangleAlert size={17} />{t('agentPermission.fullConfirmTitle')}</span>
                    <small>{t('agentPermission.fullConfirmSubtitle')}</small>
                  </div>
                </header>
                <ul className="agent-permission-risk-list">
                  <li>{t('agentPermission.fullRiskWrite')}</li>
                  <li>{t('agentPermission.fullRiskCommand')}</li>
                  <li>{t('agentPermission.fullRiskChain')}</li>
                </ul>
                <p>{t('agentPermission.fullConfirmBoundary')}</p>
                <label className="workspace-risk-ack">
                  <input
                    checked={riskAccepted}
                    type="checkbox"
                    onChange={(event) => setRiskAccepted(event.target.checked)}
                  />
                  <span>{t('agentPermission.fullConfirmAcknowledge')}</span>
                </label>
                <footer>
                  <button className="secondary-action" onClick={() => setPendingFull(false)} type="button">
                    {t('common.cancel')}
                  </button>
                  <button
                    className="primary-action"
                    disabled={!riskAccepted}
                    onClick={() => {
                      onAcknowledge()
                      setPendingFull(false)
                      onChange('full')
                    }}
                    type="button"
                  >
                    {t('agentPermission.fullConfirmEnable')}
                  </button>
                </footer>
              </section>
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  )
}
