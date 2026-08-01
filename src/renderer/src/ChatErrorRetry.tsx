/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ChatErrorRetryProps {
  error: string
  retryAt?: number
  disabled: boolean
  onRetry: () => void
}

export function ChatErrorRetry({ error, retryAt, disabled, onRetry }: ChatErrorRetryProps) {
  const { t } = useTranslation()
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0
  )
  const retriedRef = useRef(false)

  useEffect(() => {
    if (!retryAt) return

    const updateCountdown = () => {
      const remaining = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
      setRemainingSeconds(remaining)
      if (remaining === 0 && !disabled && !retriedRef.current) {
        retriedRef.current = true
        onRetry()
      }
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 250)
    return () => window.clearInterval(timer)
  }, [disabled, onRetry, retryAt])

  return (
    <div className="message-error-actions">
      {retryAt && remainingSeconds > 0 && (
        <p className="message-retry-countdown" aria-live="polite">
          {t('errors.autoRetry', { seconds: remainingSeconds })}
        </p>
      )}
      <button className="message-retry-button" disabled={disabled} type="button" onClick={onRetry}>
        <RefreshCw size={15} />
        <span>{retryAt ? t('errors.retryNow') : t('errors.resend')}</span>
      </button>
      <details className="message-error-detail">
        <summary>{t('errors.technicalDetails')}</summary>
        <pre>{error}</pre>
      </details>
    </div>
  )
}
