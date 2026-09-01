/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { CircleCheck, FolderOpen, Pause, Play, RotateCcw, ShieldCheck, Target, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ConversationWorkspace, GoalTask, GoalTaskStatus } from '@shared/types'
import { getEffectiveGoalTaskStatus } from '@shared/goalMode'

export interface GoalSetupValue {
  goal: string
  acceptanceCriteria: string
  rootPath: string
  approvalMode: NonNullable<ConversationWorkspace['approvalMode']>
  maxSteps: number
  maxDurationMinutes: number
}

export function GoalSetupDialog({ currentWorkspace, onChooseDirectory, onClose, onStart }: {
  currentWorkspace?: ConversationWorkspace
  onChooseDirectory: () => Promise<string | null>
  onClose: () => void
  onStart: (value: GoalSetupValue) => void
}) {
  const { t } = useTranslation()
  const [goal, setGoal] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [rootPath, setRootPath] = useState(currentWorkspace?.rootPath ?? '')
  const [approvalMode, setApprovalMode] = useState<NonNullable<ConversationWorkspace['approvalMode']>>(currentWorkspace?.approvalMode ?? 'auto')
  const [maxSteps, setMaxSteps] = useState(8)
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(60)
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

        <div className="goal-workspace-field">
          <span>{t('goalMode.workspace')}</span>
          <div><FolderOpen size={16} /><strong title={rootPath}>{rootPath || t('goalMode.workspaceMissing')}</strong><button disabled={choosing} onClick={() => void chooseDirectory()} type="button">{choosing ? t('goalMode.choosingWorkspace') : t('goalMode.chooseWorkspace')}</button></div>
        </div>

        <div className="goal-limit-grid">
          <label><span>{t('goalMode.approvalMode')}</span><select value={approvalMode} onChange={(event) => setApprovalMode(event.target.value as typeof approvalMode)}><option value="ask">{t('workspace.approvalAsk')}</option><option value="auto">{t('workspace.approvalAuto')}</option><option value="full">{t('workspace.approvalFull')}</option></select></label>
          <label><span>{t('goalMode.maxSteps')}</span><select value={maxSteps} onChange={(event) => setMaxSteps(Number(event.target.value))}><option value={5}>5</option><option value={8}>8</option><option value={12}>12</option><option value={14}>14</option></select></label>
          <label><span>{t('goalMode.maxDuration')}</span><select value={maxDurationMinutes} onChange={(event) => setMaxDurationMinutes(Number(event.target.value))}><option value={15}>15 {t('goalMode.minutes')}</option><option value={30}>30 {t('goalMode.minutes')}</option><option value={60}>60 {t('goalMode.minutes')}</option><option value={120}>120 {t('goalMode.minutes')}</option></select></label>
        </div>

        <div className="goal-safety-note"><ShieldCheck size={16} /><span>{t('goalMode.safetyNote')}</span></div>
        <footer><button className="secondary-action" onClick={onClose} type="button">{t('common.cancel')}</button><button className="primary-action" disabled={!goal.trim() || !acceptanceCriteria.trim() || !rootPath} onClick={() => onStart({ goal: goal.trim(), acceptanceCriteria: acceptanceCriteria.trim(), rootPath, approvalMode, maxSteps, maxDurationMinutes })} type="button"><Play size={15} />{t('goalMode.start')}</button></footer>
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
