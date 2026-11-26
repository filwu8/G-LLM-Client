/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { ChevronDown, ChevronUp, LoaderCircle, RadioTower, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelRetrySummary } from '@shared/workspaceActivity'

function formatClock(timestamp: number | undefined, language: string): string {
  if (!timestamp) return ''
  try {
    return new Date(timestamp).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

function formatElapsed(seconds: number, language: string): string {
  if (seconds < 60) return language.startsWith('zh') ? `${seconds} 秒` : `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return language.startsWith('zh') ? `${minutes} 分 ${rest} 秒` : `${minutes}m ${rest}s`
}

interface ModelRetryNoticeProps {
  summary: ModelRetrySummary
  /** Compact drops the repeated endpoint on the collapsed row (sidebar panel). */
  compact?: boolean
}

/**
 * One line for every model retry of a run, instead of one row per attempt.
 *
 * A dead upstream retried 32 times produced 32 identical "自动重试模型请求" rows
 * and no hint of who was being called. While retrying, the label carries a
 * light sweep so the run visibly moves; clicking reveals the endpoint, the
 * attempt count and the latest reason, which is what tells the user whether to
 * switch models or wait.
 */
export function ModelRetryNotice({ summary, compact = false }: ModelRetryNoticeProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN'
  const [open, setOpen] = useState(false)
  const running = summary.status === 'running'
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!running) return
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [running])

  // Measured from the first retry of the run, not from this attempt: the wait
  // is the information, and it would restart on every attempt otherwise.
  const since = summary.since
  const elapsed = since && running ? Math.max(0, Math.floor((now - since) / 1000)) : 0
  const endpoint = summary.endpoint
  // One wording for every attempt: the main process records a plain
  // "auto-retrying" label and the notice adds the running total, which is what
  // the detail panel reports. Mixing per-request "3/3" with a run total of 4
  // read like a contradiction.
  const label = running
    ? t('activityPanel.retryNoticeAttempt', { count: summary.count })
    : summary.status === 'failed'
      ? t('activityPanel.retryFailedSummary', { count: summary.count })
      : t('activityPanel.retryRecoveredSummary', { count: summary.count })
  const latestReason = summary.latest.detail

  return (
    <div className={`model-retry-notice status-${summary.status}`}>
      <button
        type="button"
        className="model-retry-main"
        aria-expanded={open}
        title={open ? t('activityPanel.retryCollapse') : t('activityPanel.retryExpand')}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="model-retry-icon">
          {running ? <LoaderCircle className="spin" size={13} /> : summary.status === 'failed' ? <RotateCcw size={13} /> : <RadioTower size={13} />}
        </span>
        <span className={running ? 'model-retry-label retry-sweep' : 'model-retry-label'}>{label}</span>
        {endpoint && !compact && <code className="model-retry-endpoint">{endpoint}</code>}
        {running && elapsed > 0 && <small className="model-retry-elapsed">{formatElapsed(elapsed, language)}</small>}
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="model-retry-detail" role="region" aria-label={t('activityPanel.retryDetailTitle')}>
          <div className="model-retry-row">
            <span>{t('activityPanel.retryEndpoint')}</span>
            <code>{endpoint || t('activityPanel.retryEndpointUnknown')}</code>
          </div>
          <div className="model-retry-row">
            <span>{t('activityPanel.retryCount')}</span>
            <strong>{t('activityPanel.retryCountValue', { count: summary.count })}</strong>
          </div>
          {latestReason && (
            <div className="model-retry-row is-reason">
              <span>{t('activityPanel.retryReasons')}</span>
              <p>{latestReason}</p>
            </div>
          )}
          {summary.since && (
            <div className="model-retry-row">
              <span>{t('activityPanel.startedAt')}</span>
              <strong>{formatClock(summary.since, language)}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
