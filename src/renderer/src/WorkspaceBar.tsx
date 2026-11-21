/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { ArrowUpRight, Check, ChevronDown, ChevronUp, CircleCheck, FileText, FolderOpen, Globe, LoaderCircle, ShieldCheck, Unplug, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { WorkspaceAgentSettingsDialog, type WorkspaceAgentSettings, type WorkspaceApplyScope } from './WorkspaceAgentSettings'

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
  const [acknowledged, setAcknowledged] = useState(false)
  const risk = prompt.risk
  const riskLabel = risk ? t(`workspace.risk${risk.level === 'high' ? 'High' : risk.level === 'medium' ? 'Medium' : 'Low'}`) : ''
  const blockedByRisk = Boolean(risk?.requiresAcknowledgement) && !acknowledged
  const configuration = prompt.tool === 'update_application_settings' || prompt.tool === 'configure_assistant_skill'
  const windowControl = prompt.tool === 'computer_window' || prompt.tool === 'browser_window'
  const desktopDescription = prompt.tool === 'computer_window' ? 'workspace.computerWindowAccessDescription'
    : prompt.tool === 'browser_window' ? 'workspace.browserWindowAccessDescription'
    : prompt.capability === 'computer' ? 'workspace.computerAccessDescription' : 'workspace.browserAccessDescription'
  return (
    <div className="assistant-modal-backdrop workspace-approval-backdrop">
      <section aria-modal="true" className="workspace-approval-dialog workspace-operation-approval" role="alertdialog">
        <header>
          <div>
            <span><ShieldCheck size={17} />{configuration ? t('workspace.configurationApprovalTitle') : prompt.capability ? t(prompt.capability === 'computer' ? 'workspace.computerApprovalTitle' : 'workspace.browserApprovalTitle') : prompt.isScript ? t('workspace.operationScriptTitle') : t('workspace.operationFileTitle')}</span>
            <small>{prompt.workspaceName}</small>
          </div>
        </header>
        <div className="workspace-operation-purpose">
          <small>{t('workspace.operationPurpose')}</small>
          <strong>{prompt.purpose}</strong>
        </div>
        {!prompt.capability && !configuration && <p>{prompt.canWrite ? t('workspace.operationWriteAccess') : t('workspace.operationReadAccess')}</p>}
        <p className={prompt.nativeExecution || prompt.capability ? 'workspace-native-warning' : ''}>{t(configuration ? 'workspace.configurationApprovalDescription' : prompt.capability ? desktopDescription : prompt.nativeExecution ? (prompt.executionMode === 'host' ? 'workspace.agentNativeBoundary' : 'workspace.agentSandboxBoundary') : 'workspace.operationBoundary')}</p>
        {windowControl && <p>{t('workspace.windowDataNotice')}</p>}
        {prompt.nativeExecution && prompt.executionMode !== 'host' && <p>{t(prompt.sandboxNetwork ? 'workspace.agentNetworkOn' : 'workspace.agentNetworkOff')}</p>}
        {prompt.cwd && <p><strong>{t('workspace.agentWorkingDirectory')}</strong> {prompt.cwd}</p>}
        {(prompt.nativeExecution || prompt.tool === 'run_computer_command') && <p>{t('workspace.agentInjectedNames')}: {prompt.envNames?.join(', ') || t('workspace.agentNoEnv')}</p>}
        {prompt.backgroundTimeoutMs && <p>{t('workspace.agentBackgroundLimit', { seconds: prompt.backgroundTimeoutMs / 1000 })}</p>}
        {prompt.preview && <pre className="workspace-code-preview"><code>{prompt.preview}</code></pre>}
        {prompt.code && <pre className="workspace-code-preview"><code>{prompt.code}</code></pre>}
        {risk && (
          <div className={`workspace-risk risk-${risk.level}`}>
            <span>{t('workspace.riskLevel')}<strong>{riskLabel}</strong></span>
            {risk.impact && <p>{risk.impact}</p>}
            {risk.reversible === false && <small>{t('workspace.riskIrreversible')}</small>}
          </div>
        )}
        {blockedByRisk && (
          <label className="workspace-risk-ack">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>{t('workspace.riskAcknowledge')}</span>
          </label>
        )}
        <footer>
          <button className="secondary-action" onClick={() => onRespond(false)} type="button">{t('workspace.operationDeny')}</button>
          <button className="primary-action" disabled={blockedByRisk} onClick={() => onRespond(true)} type="button">{t('workspace.operationAllow')}</button>
        </footer>
      </section>
    </div>
  )
}

export function WorkspaceBar({ workspace, conversationId, onOpen, onUnbind, onAgentSettingsChange, running = false }: {
  workspace: ConversationWorkspace
  conversationId?: string | null
  running?: boolean
  onAgentSettingsChange?: (settings: WorkspaceAgentSettings, scope?: WorkspaceApplyScope) => Promise<void>
  onOpen?: () => void
  onUnbind: () => void
}) {
  const { t } = useTranslation()
  // Collapsed by default: the bar is only a quiet reminder of the bound folder.
  // The approval mode lives in the composer permission picker, not here.
  const [collapsed, setCollapsed] = useState(true)
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false)
  const [browserConversationId, setBrowserConversationId] = useState<string | null>(null)
  const [browserError, setBrowserError] = useState(false)
  useEffect(() => {
    let active = true
    let receivedChange = false
    setBrowserConversationId(null)
    setBrowserError(false)
    if (!conversationId || !workspace.browserAccess) return
    const unsubscribe = window.gllm.onAgentBrowserChanged((id, open) => {
      if (id !== conversationId) return
      receivedChange = true
      setBrowserConversationId(open ? id : null)
    })
    void window.gllm.isAgentBrowserOpen(conversationId).then(open => {
      if (active && !receivedChange) setBrowserConversationId(open ? conversationId : null)
    }).catch(() => { /* The browser control is optional until a window is available. */ })
    return () => { active = false; unsubscribe() }
  }, [conversationId, workspace.browserAccess])
  return (
    <>
      <section className={`workspace-bar${collapsed ? ' is-collapsed' : ''}`}>
        <div className="workspace-bar-head">
          <div className="workspace-bar-location">
            <FolderOpen size={14} />
            <button
              className="workspace-path-button"
              onClick={collapsed ? () => setCollapsed(false) : onOpen}
              title={collapsed ? `${t('workspace.barExpand')}\n${workspace.rootPath}` : `${t('workspace.openDirectory')}\n${workspace.rootPath}`}
              type="button"
            >
              <small>{workspace.projectId ? workspace.displayName : workspace.kind === 'managed' ? t('workspace.managedDirectory') : workspace.displayName}</small>
            </button>
            {collapsed && running && <span className="workspace-bar-running" aria-hidden />}
          </div>
          {!collapsed && (
            <div className="workspace-bar-controls">
              {workspace.browserAccess && browserConversationId === conversationId && conversationId && <button className="workspace-approval-trigger" title={t('workspace.showBrowserDescription')} type="button" onClick={() => {
                setBrowserError(false)
                void window.gllm.showAgentBrowser(conversationId).then(open => {
                  if (!open) setBrowserConversationId(null)
                }).catch(() => setBrowserError(true))
              }}><Globe size={13} />{t('workspace.showBrowser')}</button>}
              {onAgentSettingsChange && <button type="button" className="workspace-approval-trigger" disabled={running} onClick={() => setAgentSettingsOpen(true)} title={t('workspace.agentSettings')}>{workspace.nativeExecution ? t(workspace.executionMode === 'host' ? 'workspace.agentNativeBadge' : 'workspace.agentSandbox') : t('workspace.agentDisabledBadge')}</button>}
              {(workspace.computerAccess || workspace.browserAccess || workspace.computerWindowAccess || workspace.browserWindowAccess) && <div className="workspace-capabilities">
                {workspace.computerAccess && <small>{t('workspace.computerAccess')}</small>}
                {workspace.browserAccess && <small>{t('workspace.browserAccess')}</small>}
                {workspace.computerWindowAccess && <small>{t('workspace.computerWindowAccess')}</small>}
                {workspace.browserWindowAccess && <small>{t('workspace.browserWindowAccess')}</small>}
              </div>}
              {!workspace.projectId && <button className="workspace-unbind-button" aria-label={t('workspace.unbind')} title={t('workspace.unbind')} type="button" onClick={onUnbind}><Unplug size={14} /></button>}
            </div>
          )}
          <button
            aria-expanded={!collapsed}
            className="workspace-bar-toggle"
            title={t(collapsed ? 'workspace.barExpand' : 'workspace.barCollapse')}
            type="button"
            onClick={() => setCollapsed(value => !value)}
          >
            <ChevronDown size={13} className={collapsed ? '' : 'is-open'} />
          </button>
        </div>
        {browserError && <small role="alert">{t('workspace.showBrowserFailed')}</small>}
      </section>
      {agentSettingsOpen && onAgentSettingsChange && <WorkspaceAgentSettingsDialog workspace={workspace} onSave={onAgentSettingsChange} onClose={() => setAgentSettingsOpen(false)} />}
    </>
  )
}

export function WorkspaceActivityLog({ activities, changedFiles, running = false, model, startedAt, artifactRoot, plan, onArtifactOpen, onArtifactContextMenu, onSeatOpen }: {
  activities: WorkspaceToolActivity[]
  changedFiles?: string[]
  running?: boolean
  model?: string
  startedAt?: number
  artifactRoot?: string
  plan?: AgentExecutionPlan
  onArtifactOpen?: (rootPath: string, relativePath: string) => void
  onArtifactContextMenu?: (event: ReactMouseEvent, rootPath: string, relativePath: string) => void
  /** Jump into the delegated seat's own conversation, where the full step list lives. */
  onSeatOpen?: (assistantId: string, conversationId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const elapsedSeconds = useElapsedSeconds(running, startedAt)
  const duration = formatElapsedDuration(elapsedSeconds, i18n.resolvedLanguage ?? i18n.language)
  // A finished step folds back to one line; only the step that is running now stays open, and an
  // explicit click always wins so the reader can pull any step up without losing the live one.
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})
  const runningId = activities.find((activity) => activity.status === 'running')?.id
  const isOpen = (activity: WorkspaceToolActivity) => manualOpen[activity.id] ?? activity.id === runningId
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
      {activities.map((activity) => {
        const index = activities.indexOf(activity) + 1
        const open = isOpen(activity)
        const seatTarget = activity.seatAssistantId && activity.seatConversationId ? { assistantId: activity.seatAssistantId, conversationId: activity.seatConversationId } : null
        return (
          <div className={`workspace-message-activity ${activity.status}${open ? ' is-open' : ''}`} key={activity.id}>
            <button
              type="button"
              className="ws-step-head"
              onClick={() => setManualOpen((current) => ({ ...current, [activity.id]: !open }))}
              aria-expanded={open}
              title={activity.detail || activity.label}
            >
              {activity.status === 'running' ? <LoaderCircle className="spin" size={14} /> : activity.status === 'completed' ? <CircleCheck size={14} /> : <XCircle size={14} />}
              <span className="ws-step-num">#{index}</span>
              <span className="ws-step-label">{activity.label}</span>
              {activity.seat && <span className="ws-step-seat">{activity.seat}</span>}
              {!open && activity.detail && <small className="ws-step-teaser">{activity.detail}</small>}
              {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {seatTarget && onSeatOpen && (
              <button
                type="button"
                className="ws-step-seat-open"
                onClick={() => onSeatOpen(seatTarget.assistantId, seatTarget.conversationId)}
                title={t('workspace.openSeat')}
                aria-label={t('workspace.openSeat')}
              >
                <ArrowUpRight size={13} />
              </button>
            )}
            {open && (
              <div className="ws-step-body">
                {activity.input && (
                  <div className="ws-step-io">
                    <small>{t('workspace.stepInput')}</small>
                    <pre>{activity.input}</pre>
                  </div>
                )}
                {activity.detail && <p className="ws-step-detail">{activity.detail}</p>}
                {activity.output && (
                  <div className="ws-step-io">
                    <small>{t('workspace.stepOutput')}</small>
                    <pre>{activity.output}</pre>
                  </div>
                )}
                {activity.steps && activity.steps.length > 0 && (
                  <ol className="ws-step-plan">
                    {activity.steps.map((step) => (
                      <li key={step.id} className={`${step.status}`} title={step.detail || step.title}>
                        {step.status === 'running' ? <LoaderCircle className="spin" size={12} /> : step.status === 'completed' ? <CircleCheck size={12} /> : step.status === 'failed' ? <XCircle size={12} /> : <span className="ws-step-plan-dot" />}
                        <span>{step.title}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        )
      })}
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

export function WorkspaceResumeNotice({ onResume, onCancel }: { onResume: () => void; onCancel: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="composer-notice" role="status">
      <span>{t('workspace.resumeAvailable')}</span>
      <div className="composer-notice-actions">
        <button type="button" onClick={onResume}>{t('workspace.resumeTask')}</button>
        <button type="button" className="danger" onClick={onCancel}>{t('workspace.cancelTask')}</button>
      </div>
    </div>
  )
}
