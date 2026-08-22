/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { Check, ChevronDown, Globe2 } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WebSearchMode } from '@shared/types'

const options: Array<{
  mode: WebSearchMode
  compactLabel: string
  labelKey: string
  descriptionKey: string
}> = [
  {
    mode: 'auto',
    compactLabel: 'Auto',
    labelKey: 'app.webSearchModeAuto',
    descriptionKey: 'app.webSearchModeAutoDescription'
  },
  {
    mode: 'on',
    compactLabel: 'On',
    labelKey: 'app.webSearchModeOn',
    descriptionKey: 'app.webSearchModeOnDescription'
  },
  {
    mode: 'off',
    compactLabel: 'Off',
    labelKey: 'app.webSearchModeOff',
    descriptionKey: 'app.webSearchModeOffDescription'
  }
]

export function WebSearchModePicker({
  mode,
  disabled = false,
  onChange
}: {
  mode: WebSearchMode
  disabled?: boolean
  onChange: (mode: WebSearchMode) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>()
  const pickerRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.mode === mode) ?? options[0]

  useEffect(() => {
    if (!open) return

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false)
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

  function toggleMenu() {
    if (open) {
      setOpen(false)
      return
    }

    const triggerRect = pickerRef.current?.getBoundingClientRect()
    if (triggerRect) {
      const viewportPadding = 12
      const width = Math.min(292, window.innerWidth - viewportPadding * 2)
      const left = Math.max(
        viewportPadding,
        Math.min(triggerRect.left, window.innerWidth - width - viewportPadding)
      )
      setMenuStyle({
        bottom: window.innerHeight - triggerRect.top + 9,
        left,
        width
      })
    }
    setOpen(true)
  }

  return (
    <div className={`web-search-mode-picker mode-${mode}`} ref={pickerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={`web-search-mode-trigger ${mode !== 'off' ? 'active' : ''}`}
        disabled={disabled}
        title={`${t('app.webSearch')}: ${t(selected.labelKey)} · ${t(selected.descriptionKey)}`}
        type="button"
        onClick={toggleMenu}
      >
        <Globe2 size={16} />
        <span>{selected.compactLabel}</span>
        <ChevronDown size={12} />
      </button>
      {open && !disabled && (
        <div className="web-search-mode-menu" role="menu" style={menuStyle}>
          {options.map((option) => (
            <button
              key={option.mode}
              aria-checked={mode === option.mode}
              className={mode === option.mode ? 'selected' : ''}
              role="menuitemradio"
              type="button"
              onClick={() => {
                onChange(option.mode)
                setOpen(false)
              }}
            >
              <span className="web-search-mode-check">{mode === option.mode && <Check size={15} />}</span>
              <span className="web-search-mode-copy">
                <strong>{t(option.labelKey)}</strong>
                <small>{t(option.descriptionKey)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
