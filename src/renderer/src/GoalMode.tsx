/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { CircleCheck, FolderOpen, Globe2, Pause, Play, RotateCcw, ShieldCheck, Target, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConversationWorkspace, GoalContextMode, GoalTask, GoalTaskStatus, GoalWebSearchScope, WebSearchMode } from '@shared/types'
import { getEffectiveGoalTaskStatus } from '@shared/goalMode'
import { normalizeGoalWebSearchDomains } from '@shared/goalWebSearch'

export interface GoalSetupValue {
  goal: string
  acceptanceCriteria: string
  rootPath: string
  approvalMode: NonNullable<ConversationWorkspace['approvalMode']>
  maxSteps: number
  maxDurationMinutes: number
  webSearchMode: WebSearchMode
  webSearchScope: GoalWebSearchScope
  webSearchDomains: string[]
  contextMode: GoalContextMode
}

export function GoalSetupDialog({ currentWorkspace, defaultWebSearchMode, initialGoal, onChooseDirectory, onClose, onStart }: {
  currentWorkspace?: ConversationWorkspace
  defaultWebSearchMode?: WebSearchMode
  initialGoal?: string
  onChooseDirectory: () => Promise<string | null>
  onClose: () => void
  onStart: (value: GoalSetupValue) => void
}) {
  const { t } = useTranslation()
  const [goal, setGoal] = useState(() => initialGoal?.trim() ?? '')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [contextMode, setContextMode] = useState<GoalContextMode>('auto')
  const [rootPath, setRootPath] = useState(currentWorkspace?.rootPath ?? '')
  const [approvalMode, setApprovalMode] = useState<NonNullable<ConversationWorkspace['approvalMode']>>(currentWorkspace?.approvalMode ?? 'auto')
  const [maxSteps, setMaxSteps] = useState(8)
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(60)
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>(defaultWebSearchMode ?? 'auto')
  const [webSearchScope, setWebSearchScope] = useState<GoalWebSearchScope>('all')
  const [webSearchDomains, setWebSearchDomains] = useState('')
  const [choosing, setChoosing] = useState(false)

  useEffect(() => {
    if (currentWorkspace?.rootPath) setRootPath(currentWorkspace.rootPath)
  }, [currentWorkspace?.rootPath])

  async function chooseDirectory() {
    if (choosing) return
    setChoosing(true)
    try {
      const selected = await onChooseDirectory()
      if (selected) setRootPath(selected)
    } finally {
      setChoosing(false)
    }
  }

  return (
    <div className="assistant-modal-backdrop goal-setup-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section aria-modal="true" className="goal-setup-dialog" role="dialog">
        <header>
          <div><Target size={20} /><span><strong>{t('goalMode.setupTitle')}</strong><small>{t('goalMode.setupDescription')}</small></span></div>
          <button aria-label={t('common.close')} className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </header>

        <label className="goal-setup-field">
          <span>{t('goalMode.goal')}</span>
          <textarea autoFocus maxLength={2000} rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder={t('goalMode.goalPlaceholder')} />
        </label>
        <label className="goal-setup-field">
          <span>{t('goalMode.acceptanceCriteria')}</span>
          <textarea maxLength={3000} rows={3} value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} placeholder={t('goalMode.acceptancePlaceholder')} />
        </label>

        <label className="goal-context-setting">
          <span>{t('goalMode.contextMode')}</span>
          <select value={contextMode} onChange={(event) => setContextMode(event.target.value as GoalContextMode)}>
            <option value="auto">{t('goalMode.contextAuto')}</option>
            <option value="continue">{t('goalMode.contextContinue')}</option>
            <option value="relevant">{t('goalMode.contextRelevant')}</option>
            <option value="isolated">{t('goalMode.contextIsolated')}</option>
          </select>
          <small>{t(`goalMode.contextDescription.${contextMode}`)}</small>
        </label>

        <div className="goal-workspace-field">
          <span>{t('goalMode.workspace')}</span>
          <div><FolderOpen size={16} /><strong title={rootPath}>{rootPath || t('goalMode.workspaceMissing')}</strong><button disabled={choosing} onClick={() => void chooseDirectory()} type="button">{choosing ? t('goalMode.choosingWorkspace') : t('goalMode.chooseWorkspace')}</button></div>
        </div>

        <div className="goal-limit-grid">
          <label><span>{t('goalMode.approvalMode')}</span><select value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as typeof approvalMode)}><option value="ask">{t('workspace.approvalAsk')}</option><option value="auto">{t('workspace.approvalAuto')}</option><option value="full">{t('workspace.approvalFull')}</option></select></label>
          <label><span>{t('goalMode.maxSteps')}</span><select value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))}><option value={5}>5</option><option value={8}>8</option><option value={12}>12</option><option value={14}>14</option></select></label>
          <label><span>{t('goalMode.maxDuration')}</span><select value={maxDurationMinutes} onChange={(event) => setMaxDurationMinutes(Number(event.target.value))}><option value={15}>15 {t('goalMode.minutes')}</option><option value={30}>30 {t('goalMode.minutes')}</option><option value={60}>60 {t('goalMode.minutes')}</option><option value={120}>120 {t('goalMode.minutes')}</option></select></label>
        </div>

        <section className="goal-search-settings">
          <header><Globe2 size={16} /><span><strong>{t('goalMode.webSearch')}</strong><small>{t('goalMode.webSearchDescription')}</small></span></header>
          <div className="goal-search-grid">
            <label><span>{t('goalMode.webSearchMode')}</span><select value={webSearchMode} onChange={(event) => setWebSearchMode(event.target.value as WebSearchMode)}><option value="auto">{t('app.webSearchModeAuto')}</option><option value="on">{t('app.webSearchModeOn')}</option><option value="off">{t('app.webSearchModeOff')}</option></select></label>
            <label><span>{t('goalMode.webSearchScope')}</span><select disabled={webSearchMode === 'off'} value={webSearchScope} onChange={(event) => setWebSearchScope(event.target.value as GoalWebSearchScope)}><option value="all">{t('goalMode.searchScopeAll')}</option><option value="official">{t('goalMode.searchScopeOfficial')}</option><option value="specified">{t('goalMode.searchScopeSpecified')}</option></select></label>
          </div>
          {webSearchMode !== 'off' && webSearchScope === 'specified' && <label className="goal-domain-field"><span>{t('goalMode.specifiedDomains')}</span><input value={webSearchDomains} onChange={(event) => setWebSearchDomains(event.target.value)} placeholder={t('goalMode.specifiedDomainsPlaceholder')} /><small>{t('goalMode.specifiedDomainsHint')}</small></label>}
        </section>

        <div className="goal-safety-note"><ShieldCheck size={16} /><span>{t('goalMode.safetyNote')}</span></div>
        <footer><button className="secondary-action" onClick={onClose} type="button">{t('common.cancel')}</button><button className="primary-action" disabled={!goal.trim() || !acceptanceCriteria.trim() || !rootPath || (webSearchMode !== 'off' && webSearchScope === 'specified' && normalizeGoalWebSearchDomains(webSearchDomains).length === 0)} onClick={() => onStart({ goal: goal.trim(), acceptanceCriteria: acceptanceCriteria.trim(), rootPath, approvalMode, maxSteps, maxDurationMinutes, webSearchMode, webSearchScope, webSearchDomains: normalizeGoalWebSearchDomains(webSearchDomains), contextMode })} type="button"><Play size={15} />{t('goalMode.start')}</button></footer>
      </section>
    </div>
  )
}

export function GoalTaskPanel({ task, running, onPause, onResume, onClear, onNewGoal }: {
  task: GoalTask
  running: boolean
  onPause: () => void
  onResume: () => void
  onClear: () => void
  onNewGoal: () => void
}) {
  const { t } = useTranslation()
  const displayStatus: GoalTaskStatus = getEffectiveGoalTaskStatus(task, running)
  return (
    <section className={`goal-task-panel status-${displayStatus}`} title={task.lastError ?? task.lastPlan?.verification}>
      <div className="goal-task-summary">
        <header>
          <Target size={14} />
          <span>{t('goalMode.activeGoal')}</span>
          <strong title={task.goal}>{task.goal}</strong>
          <small>{t(`goalMode.status.${displayStatus}`)}</small>
        </header>
        <div className="goal-task-meta">
          <span>{t('goalMode.runCount', { count: task.runCount })}</span>
          <span>{t('goalMode.limits', { steps: task.maxSteps, minutes: task.maxDurationMinutes })}</span>
          {task.resolvedContextMode && <span>{t(`goalMode.contextResolved.${task.resolvedContextMode}`)}</span>}
          {task.lastPlan?.steps.map((step) => (
            <span className={`goal-task-step ${step.status}`} key={step.id} title={step.detail}>
              {step.status === 'completed' ? <CircleCheck size={10} /> : <i />}
              {step.title}
            </span>
          ))}
        </div>
      </div>
      <footer>
        {running ? <button onClick={onPause} type="button"><Pause size={14} />{t('goalMode.pause')}</button> : ['paused', 'failed'].includes(displayStatus) ? <button className="primary" onClick={onResume} type="button"><Play size={14} />{t('goalMode.resume')}</button> : null}
        <button className="danger" onClick={onClear} type="button"><X size={14} />{t(['completed', 'stopped'].includes(displayStatus) ? 'goalMode.clear' : 'goalMode.cancelGoal')}</button>
        {['completed', 'stopped'].includes(displayStatus) && <button onClick={onNewGoal} type="button"><RotateCcw size={14} />{t('goalMode.newGoal')}</button>}
      </footer>
    </section>
  )
}
