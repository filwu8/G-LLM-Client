/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { Check, ChevronDown, CircleCheck, FileText, FolderOpen, LoaderCircle, ShieldCheck, Unplug, X, XCircle } from 'lucide-react'
import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConversationWorkspace, WorkspaceApprovalPrompt, WorkspaceToolActivity } from '@shared/types'

type WorkspaceApprovalMode = NonNullable<ConversationWorkspace['approvalMode']>

const approvalModes: WorkspaceApprovalMode[] = ['ask', 'auto', 'full']

function approvalText(mode: WorkspaceApprovalMode, t: ReturnType<typeof useTranslation>['t']) {
  if (mode === 'full') return { label: t('workspace.approvalFull'), description: t('workspace.approvalFullDescription') }
  if (mode === 'auto') return { label: t('workspace.approvalAuto'), description: t('workspace.approvalAutoDescription') }
  return { label: t('workspace.approvalAsk'), description: t('workspace.approvalAskDescription') }
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

export function WorkspaceBar({ workspace, onUnbind, onApprovalModeChange }: {
  workspace: ConversationWorkspace
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
          <div><small title={workspace.rootPath}>{workspace.rootPath}</small></div>
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

export function WorkspaceActivityLog({ activities, changedFiles, running = false, artifactRoot, onArtifactOpen, onArtifactContextMenu }: {
  activities: WorkspaceToolActivity[]
  changedFiles?: string[]
  running?: boolean
  artifactRoot?: string
  onArtifactOpen?: (rootPath: string, relativePath: string) => void
  onArtifactContextMenu?: (event: ReactMouseEvent, rootPath: string, relativePath: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="workspace-message-activities">
      <div className="workspace-message-activities-title">
        {running && <LoaderCircle className="spin" size={14} />}
        <strong>{running ? (activities.length > 0 ? t('workspace.operating') : t('workspace.understanding')) : activities.length > 0 ? t('workspace.activityLog') : t('workspace.generatedFiles')}</strong>
      </div>
      {activities.length === 0 && running && <small>{t('workspace.readingContext')}</small>}
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
