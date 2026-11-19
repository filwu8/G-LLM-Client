/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { ChevronDown, ChevronUp, CircleCheck, CircleHelp, Clock3, FileText, KeyRound, LoaderCircle, ShieldAlert, Terminal, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentExecutionPlan, WorkspaceToolActivity } from '@shared/types'

export interface OutlineEntry {
  id: string
  label: string
}

interface AgentActivityPanelProps {
  activities: WorkspaceToolActivity[]
  changedFiles: string[]
  plan?: AgentExecutionPlan
  running: boolean
  startedAt?: number
  goal?: string
  pendingApproval?: { id: string; purpose: string; tool?: string } | null
  pendingQuestion?: { id: string; title: string; kind: 'question' | 'auth' } | null
  entries: OutlineEntry[]
  activeId: string | null
  onJump: (id: string) => void
  onCollapse: () => void
  onOpenFile?: (relativePath: string) => void
}

type ActivityState = 'idle' | 'running' | 'waiting' | 'completed' | 'failed'

const COMPACT_LIMIT = 5

/** Tools that mutate the host or delete data: surfaced with an explicit risk marker. */
const DANGEROUS_TOOLS = new Set([
  'run_shell',
  'run_python',
  'run_computer_command',
  'run_project_check',
  'start_background',
  'git_write',
  'delete_file',
  'remove_file',
  'delete_directory',
  'move_file'
])

function formatClock(timestamp: number | undefined, language: string): string {
  if (!timestamp) return ''
  try {
    return new Date(timestamp).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

function formatRelative(timestamp: number | undefined, language: string): string {
  if (!timestamp) return ''
  const delta = Date.now() - timestamp
  if (delta < 60_000) return language.startsWith('zh') ? '刚刚' : 'just now'
  const minutes = Math.round(delta / 60_000)
  if (minutes < 60) return language.startsWith('zh') ? `${minutes} 分钟前` : `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return language.startsWith('zh') ? `${hours} 小时前` : `${hours} h ago`
  const days = Math.round(hours / 24)
  return language.startsWith('zh') ? `${days} 天前` : `${days} d ago`
}

function activityIcon(status: WorkspaceToolActivity['status']) {
  if (status === 'running') return <LoaderCircle className="spin" size={13} />
  if (status === 'completed') return <CircleCheck size={13} />
  return <XCircle size={13} />
}

/**
 * Floating agent activity panel pinned to the right edge of the conversation.
 *
 * Compact by default: current task plus the most recent operations. Expanding
 * reveals the full tool-call timeline, per-operation timing and touched files,
 * which keeps long autonomous runs attributable after the fact.
 */
export function AgentActivityPanel({
  activities,
  changedFiles,
  plan,
  running,
  startedAt,
  goal,
  pendingApproval,
  pendingQuestion,
  entries,
  activeId,
  onJump,
  onCollapse,
  onOpenFile
}: AgentActivityPanelProps) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN'
  const [expanded, setExpanded] = useState(false)
  const [openDetailId, setOpenDetailId] = useState<string | null>(null)

  const steps = plan?.steps ?? []
  const completedSteps = steps.filter((step) => step.status === 'completed' || step.status === 'skipped').length
  const percent = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0

  const lastActivity = activities.at(-1)
  const state: ActivityState = (pendingApproval || pendingQuestion)
    ? 'waiting'
    : running || lastActivity?.status === 'running'
      ? 'running'
      : lastActivity?.status === 'failed' || plan?.status === 'failed'
        ? 'failed'
        : activities.length > 0
          ? 'completed'
          : 'idle'

  const stateLabel = {
    idle: t('activityPanel.stateIdle'),
    running: t('activityPanel.stateRunning'),
    waiting: t('activityPanel.stateWaiting'),
    completed: t('activityPanel.stateCompleted'),
    failed: t('activityPanel.stateFailed')
  }[state]

  const visible = useMemo(
    () => (expanded ? activities.slice(-120) : activities.slice(-COMPACT_LIMIT)).slice().reverse(),
    [activities, expanded]
  )
  const hiddenCount = Math.max(0, activities.length - COMPACT_LIMIT)
  const latestChangeAt = activities.at(-1)?.endedAt ?? activities.at(-1)?.startedAt ?? startedAt

  const currentTask = goal?.trim() || entries.at(-1)?.label || ''

  return (
    <aside className={`agent-activity-panel state-${state}`} aria-label={t('activityPanel.title')}>
      <header className="aap-header">
        <div className="aap-header-main">
          <span className={`aap-state state-${state}`}>
            {state === 'running' ? <LoaderCircle className="spin" size={12} />
              : state === 'waiting' ? <ShieldAlert size={12} />
                : state === 'failed' ? <XCircle size={12} />
                  : state === 'completed' ? <CircleCheck size={12} />
                    : <Clock3 size={12} />}
            {stateLabel}
          </span>
          <strong>{t('activityPanel.title')}</strong>
        </div>
        <button type="button" className="aap-icon-button" title={t('activityPanel.collapse')} onClick={onCollapse}>
          ›
        </button>
      </header>

      {currentTask && (
        <div className="aap-task" title={currentTask}>
          <small>{t('activityPanel.currentTask')}</small>
          <span>{currentTask}</span>
        </div>
      )}

      {steps.length > 0 && (
        <div className={`aap-plan${running ? ' is-running' : ''}`}>
          <div className="aap-plan-head">
            <span>{t('activityPanel.progress', { done: completedSteps, total: steps.length })}</span>
            <span>{percent}%</span>
          </div>
          <div className="aap-plan-bar"><i style={{ width: `${percent}%` }} /></div>
          {expanded && (
            <ol className="aap-plan-steps">
              {steps.map((step) => (
                <li key={step.id} className={`status-${step.status}`} title={step.detail || step.title}>
                  {step.status === 'running' ? <LoaderCircle className="spin" size={12} />
                    : step.status === 'completed' ? <CircleCheck size={12} />
                      : step.status === 'failed' ? <XCircle size={12} />
                        : <span className="aap-step-dot" />}
                  <span>{step.title}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {pendingApproval && (
        <div className="aap-approval" role="status">
          <ShieldAlert size={13} />
          <div>
            <strong>{t('activityPanel.awaitingApproval')}</strong>
            <span title={pendingApproval.purpose}>{pendingApproval.tool ? `${pendingApproval.tool} · ` : ''}{pendingApproval.purpose}</span>
          </div>
        </div>
      )}
      {!pendingApproval && pendingQuestion && (
        <div className="aap-approval is-question" role="status">
          {pendingQuestion.kind === 'auth' ? <KeyRound size={13} /> : <CircleHelp size={13} />}
          <div>
            <strong>{t('activityPanel.awaitingAnswer')}</strong>
            <span title={pendingQuestion.title}>{pendingQuestion.title}</span>
          </div>
        </div>
      )}

      <div className="aap-section-head">
        <span>{expanded ? t('activityPanel.allOperations') : t('activityPanel.recentOperations')}</span>
        <small>{activities.length}</small>
      </div>

      {activities.length === 0 && (
        <p className="aap-empty">{t('activityPanel.empty')}</p>
      )}

      <ol className="aap-list">
        {visible.map((activity) => {
          const detailOpen = openDetailId === activity.id
          const hasDetail = Boolean(activity.detail) || Boolean(activity.files?.length) || Boolean(activity.startedAt)
          return (
            <li key={activity.id} className={`aap-item status-${activity.status}`}>
              <button
                type="button"
                className="aap-item-main"
                onClick={() => setOpenDetailId(detailOpen ? null : activity.id)}
                title={activity.detail || activity.label}
                aria-expanded={detailOpen}
              >
                <span className="aap-item-icon">{activityIcon(activity.status)}</span>
                <span className="aap-item-label">{activity.label}</span>
                {DANGEROUS_TOOLS.has(activity.tool) && (
                  <ShieldAlert className="aap-item-risk" size={11} aria-label={t('activityPanel.sensitive')} />
                )}
                <time className="aap-item-time">{formatClock(activity.startedAt ?? activity.endedAt, language)}</time>
                {hasDetail && (detailOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
              </button>
              {detailOpen && (
                <div className="aap-item-detail">
                  <div className="aap-item-tool"><Terminal size={11} /><code>{activity.tool}</code></div>
                  {activity.detail && <p>{activity.detail}</p>}
                  <div className="aap-item-times">
                    {activity.startedAt && <span>{t('activityPanel.startedAt')} {formatClock(activity.startedAt, language)}</span>}
                    {activity.endedAt && <span>{t('activityPanel.endedAt')} {formatClock(activity.endedAt, language)}</span>}
                  </div>
                  {activity.files && activity.files.length > 0 && (
                    <div className="aap-item-files">
                      {activity.files.map((file) => (
                        <button key={file} type="button" title={file} onClick={() => onOpenFile?.(file)}>
                          <FileText size={11} />
                          <span>{file}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {hiddenCount > 0 && !expanded && (
        <button type="button" className="aap-more" onClick={() => setExpanded(true)}>
          {t('activityPanel.showAll', { count: activities.length })}
          <ChevronDown size={12} />
        </button>
      )}
      {expanded && activities.length > COMPACT_LIMIT && (
        <button type="button" className="aap-more" onClick={() => setExpanded(false)}>
          {t('activityPanel.showLess')}
          <ChevronUp size={12} />
        </button>
      )}

      {changedFiles.length > 0 && (
        <div className="aap-files">
          <div className="aap-section-head">
            <span>{t('activityPanel.changedFiles')}</span>
            <small>{changedFiles.length}</small>
          </div>
          <div className="aap-file-list">
            {changedFiles.slice(0, expanded ? 60 : 4).map((file) => (
              <button key={file} type="button" title={`${file}\n${formatRelative(latestChangeAt, language)}`} onClick={() => onOpenFile?.(file)}>
                <FileText size={11} />
                <span>{file}</span>
              </button>
            ))}
          </div>
          {changedFiles.length > (expanded ? 60 : 4) && (
            <button type="button" className="aap-more" onClick={() => setExpanded(true)}>
              {t('activityPanel.moreFiles', { count: changedFiles.length - (expanded ? 60 : 4) })}
            </button>
          )}
        </div>
      )}

      {expanded && entries.length > 0 && (
        <div className="aap-turns">
          <div className="aap-section-head">
            <span>{t('activityPanel.turns')}</span>
            <small>{entries.length}</small>
          </div>
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`aap-turn${entry.id === activeId ? ' is-active' : ''}`}
              title={entry.label}
              onClick={() => onJump(entry.id)}
            >
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
