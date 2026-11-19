/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { useTranslation } from 'react-i18next'

import type { AgentExecutionPlan } from '@shared/types'

export interface OutlineEntry {
  id: string
  label: string
}

interface ConversationOutlineProps {
  entries: OutlineEntry[]
  activeId: string | null
  plan?: AgentExecutionPlan
  onJump: (id: string) => void
}

const stepStatusLabel: Record<string, string> = {
  pending: '○',
  running: '◐',
  completed: '●',
  failed: '✕',
  skipped: '–'
}

/**
 * A floating overview rail on the right edge of the chat. During long or
 * complex tasks it shows overall plan progress plus a jumpable outline of the
 * user's turns, mirroring the WorkBuddy overview panel.
 */
export function ConversationOutline({ entries, activeId, plan, onJump }: ConversationOutlineProps) {
  const { t } = useTranslation()
  const steps = plan?.steps ?? []
  const completed = steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length
  const running = plan?.status === 'executing' || plan?.status === 'planning' || plan?.status === 'verifying'
  const percent = steps.length > 0 ? Math.round((completed / steps.length) * 100) : 0

  if (entries.length === 0 && steps.length === 0) return null

  return (
    <aside className="conversation-outline" aria-label={t('goalMode.outlineTitle')}>
      {steps.length > 0 && (
        <div className={`conversation-outline-plan${running ? ' is-running' : ''}`}>
          <div className="conversation-outline-plan-head">
            <span>{t('goalMode.outlineProgress', { done: completed, total: steps.length })}</span>
            <span>{percent}%</span>
          </div>
          <div className="conversation-outline-bar">
            <i style={{ width: `${percent}%` }} />
          </div>
          <ol>
            {steps.map((step) => (
              <li key={step.id} className={`status-${step.status}`} title={step.detail || step.title}>
                <span className="conversation-outline-dot">{stepStatusLabel[step.status] ?? '○'}</span>
                <span className="conversation-outline-step">{step.title}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {entries.length > 0 && (
        <div className="conversation-outline-turns">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`conversation-outline-turn${entry.id === activeId ? ' is-active' : ''}`}
              title={entry.label}
              onClick={() => onJump(entry.id)}
            >
              <span className="conversation-outline-label">{entry.label}</span>
              <i className="conversation-outline-tick" />
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
