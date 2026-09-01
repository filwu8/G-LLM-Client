/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { Check, ChevronDown, CircleCheck, FileText, FolderOpen, LoaderCircle, ShieldCheck, Unplug, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { AgentExecutionPlan, ConversationWorkspace, WorkspaceApprovalPrompt, WorkspaceToolActivity } from '@shared/types'

type WorkspaceApprovalMode = NonNullable<ConversationWorkspace['approvalMode']>

const approvalModes: WorkspaceApprovalMode[] = ['ask', 'auto', 'full']

function approvalText(mode: WorkspaceApprovalMode, t: ReturnType<typeof useTranslation>['t']) {
  if (mode === 'full') return { label: t('workspace.approvalFull'), description: t('workspace.approvalFullDescription') }
  if (mode === 'auto') return { label: t('workspace.approvalAuto'), description: t('workspace.approvalAutoDescription') }
  return { label: t('workspace.approvalAsk'), description: t('workspace.approvalAskDescription') }
}

function useElapsedSeconds(running: boolean, startedAt?: number): number {
  const fallbackStartedAt = useRef(Date.now())
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!running) return
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 1_000)
    return () => window.clearInterval(timer)
  }, [running, startedAt])

  return Math.max(0, Math.floor((now - (startedAt ?? fallbackStartedAt.current)) / 1_000))
}

function formatElapsedDuration(seconds: number, language: string): string {
  if (seconds < 60) return language.startsWith('zh') ? `${seconds} 秒` : `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return language.startsWith('zh') ? `${minutes} 分 ${remainder} 秒` : `${minutes}m ${remainder}s`
}

export function ModelResponseWait({ model, startedAt }: { model: string; startedAt?: number }) {
  const { t, i18n } = useTranslation()
  const elapsedSeconds = useElapsedSeconds(true, startedAt)
  const duration = formatElapsedDuration(elapsedSeconds, i18n.resolvedLanguage ?? i18n.language)
  return (
    <div className="pending-response-content">
      <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="pending-response-copy">
        <span className="model-wait-shimmer">{t('app.waitingForModel', { model })}</span>
        <small>{t('workspace.waitingElapsed', { duration })}</small>
      </span>
    </div>
  )
}

export function WorkspaceApprovalDialog({ rootPath, currentMode, onSelect, onCancel }: {
  rootPath: string
  currentMode?: WorkspaceApprovalMode
  onSelect: (mode: WorkspaceApprovalMode) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="assistant-modal-backdrop workspace-approval-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <section aria-modal="true" className="workspace-approval-dialog" role="dialog">
        <header>
          <div>
            <span><ShieldCheck size={17} />{t('workspace.approvalTitle')}</span>
            <small title={rootPath}>{rootPath}</small>
          </div>
          <button aria-label={t('common.close')} className="icon-button" onClick={onCancel} type="button"><X size={18} /></button>
        </header>
        <p>{t('workspace.approvalDescription')}</p>
        <div className="workspace-approval-options">
          {approvalModes.map((mode) => {
            const text = approvalText(mode, t)
            return (
              <button className={`mode-${mode} ${mode === 'auto' ? 'recommended ' : ''}${currentMode === mode ? 'selected' : ''}`} key={mode} onClick={() => onSelect(mode)} type="button">
                <span>
                  {text.label}
                  <span className="workspace-approval-option-meta">
                    {mode === 'auto' && <small>{t('workspace.recommended')}</small>}
                    {currentMode === mode && <Check size={15} />}
                  </span>
                </span>
                <p>{text.description}</p>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export function WorkspaceOperationApprovalDialog({ prompt, onRespond }: {
  prompt: WorkspaceApprovalPrompt
  onRespond: (approved: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="assistant-modal-backdrop workspace-approval-backdrop">
      <section aria-modal="true" className="workspace-approval-dialog workspace-operation-approval" role="alertdialog">
        <header>
          <div>
            <span><ShieldCheck size={17} />{prompt.isScript ? t('workspace.operationScriptTitle') : t('workspace.operationFileTitle')}</span>
            <small>{prompt.workspaceName}</small>
          </div>
        </header>
        <div className="workspace-operation-purpose">
          <small>{t('workspace.operationPurpose')}</small>
          <strong>{prompt.purpose}</strong>
        </div>
        <p>{prompt.canWrite ? t('workspace.operationWriteAccess') : t('workspace.operationReadAccess')}</p>
        <p>{t('workspace.operationBoundary')}</p>
        <footer>
          <button className="secondary-action" onClick={() => onRespond(false)} type="button">{t('workspace.operationDeny')}</button>
          <button className="primary-action" onClick={() => onRespond(true)} type="button">{t('workspace.operationAllow')}</button>
        </footer>
      </section>
    </div>
  )
}

export function WorkspaceBar({ workspace, onOpen, onUnbind, onApprovalModeChange }: {
  workspace: ConversationWorkspace
  onOpen?: () => void
  onUnbind: () => void
  onApprovalModeChange?: (mode: WorkspaceApprovalMode) => void
}) {
  const { t } = useTranslation()
  const [approvalPickerOpen, setApprovalPickerOpen] = useState(false)
  const approvalLabel = workspace.approvalMode === 'full'
    ? t('workspace.approvalFull')
    : workspace.approvalMode === 'auto'
      ? t('workspace.approvalAuto')
      : t('workspace.approvalAsk')
  return (
    <>
      <section className="workspace-bar">
        <div className="workspace-bar-head">
          <FolderOpen size={14} />
          <button className="workspace-path-button" onClick={onOpen} title={t('workspace.openDirectory')} type="button">
            <small>{workspace.rootPath}</small>
          </button>
          <button
            aria-haspopup="dialog"
            className={`workspace-approval-trigger mode-${workspace.approvalMode ?? 'ask'}`}
            title={t('workspace.approvalChange')}
            type="button"
            onClick={() => setApprovalPickerOpen(true)}
          >
            <ShieldCheck size={13} />
            <span>{approvalLabel}</span>
            <ChevronDown size={12} />
          </button>
          <button title={t('workspace.unbind')} type="button" onClick={onUnbind}><Unplug size={14} /></button>
        </div>
      </section>
      {approvalPickerOpen && (
        <WorkspaceApprovalDialog
          currentMode={workspace.approvalMode ?? 'ask'}
          rootPath={workspace.rootPath}
          onCancel={() => setApprovalPickerOpen(false)}
          onSelect={(mode) => {
            onApprovalModeChange?.(mode)
            setApprovalPickerOpen(false)
          }}
        />
      )}
    </>
  )
}

export function WorkspaceActivityLog({ activities, changedFiles, running = false, model, startedAt, artifactRoot, plan, onArtifactOpen, onArtifactContextMenu }: {
  activities: WorkspaceToolActivity[]
  changedFiles?: string[]
  running?: boolean
  model?: string
  startedAt?: number
  artifactRoot?: string
  plan?: AgentExecutionPlan
  onArtifactOpen?: (rootPath: string, relativePath: string) => void
  onArtifactContextMenu?: (event: ReactMouseEvent, rootPath: string, relativePath: string) => void
}) {
  const { t, i18n } = useTranslation()
  const elapsedSeconds = useElapsedSeconds(running, startedAt)
  const duration = formatElapsedDuration(elapsedSeconds, i18n.resolvedLanguage ?? i18n.language)
  return (
    <div className="workspace-message-activities">
      {plan && (
        <div className={`agent-plan agent-plan-${plan.status}`}>
          <div className="agent-plan-goal"><strong>{t('workspace.goal')}</strong><span>{plan.goal}</span></div>
          <div className="agent-plan-steps">
            {plan.steps.map((step) => (
              <div className={`agent-plan-step ${step.status}`} key={step.id} title={step.detail}>
                {step.status === 'running' ? <LoaderCircle className="spin" size={13} /> : step.status === 'completed' ? <CircleCheck size={13} /> : step.status === 'failed' ? <XCircle size={13} /> : <span className="agent-plan-step-dot" />}
                <span>{step.title}</span>
              </div>
            ))}
          </div>
          {plan.verification && <small className="agent-plan-verification">{t('workspace.verification')}: {plan.verification}</small>}
        </div>
      )}
      <div className="workspace-message-activities-title">
        {running && <LoaderCircle className="spin" size={14} />}
        <strong>{running ? (activities.length > 0 ? t('workspace.operating') : t('workspace.understanding')) : activities.length > 0 ? t('workspace.activityLog') : t('workspace.generatedFiles')}</strong>
        {running && <small>{t('workspace.elapsed', { duration })}</small>}
      </div>
      {activities.length === 0 && running && (
        <small>{model ? t('app.waitingForModel', { model }) : t('workspace.readingContext')}</small>
      )}
      {activities.map((activity) => (
        <div className={`workspace-message-activity ${activity.status}`} key={activity.id} title={activity.detail}>
          {activity.status === 'running' ? <LoaderCircle className="spin" size={14} /> : activity.status === 'completed' ? <CircleCheck size={14} /> : <XCircle size={14} />}
          <span>{activity.label}</span>
          {activity.detail && <small>{activity.detail}</small>}
        </div>
      ))}
      {changedFiles && changedFiles.length > 0 && (
        <div className="workspace-changed-files">
          <span>{t('workspace.changedFiles')}</span>
          <div>
            {changedFiles.map((file) => {
              const separator = artifactRoot?.includes('\\') ? '\\' : '/'
              const fullPath = artifactRoot ? `${artifactRoot.replace(/[\\/]+$/, '')}${separator}${file}` : file
              return (
              <button
                key={file}
                title={`${fullPath}\n${t('workspace.revealHint')}`}
                type="button"
                onClick={() => {
                  if (artifactRoot && onArtifactOpen) onArtifactOpen(artifactRoot, file)
                }}
                onContextMenu={(event) => {
                  if (!artifactRoot || !onArtifactContextMenu) return
                  event.preventDefault()
                  onArtifactContextMenu(event, artifactRoot, file)
                }}
              >
                <FileText size={13} />
                <span>{file}</span>
              </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
