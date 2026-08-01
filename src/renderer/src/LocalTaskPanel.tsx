/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { CircleCheck, FolderOpen, LoaderCircle, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { LocalTaskPlan, LocalTaskProgress, LocalTaskResult } from '@shared/types'

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${Number((size / 1024 / 1024).toFixed(2))} MiB`
  if (size >= 1024) return `${Number((size / 1024).toFixed(1))} KiB`
  return `${size} B`
}

interface LocalTaskPanelProps {
  plan: LocalTaskPlan
  progress: LocalTaskProgress | null
  result: LocalTaskResult | null
  running: boolean
  onApprove: () => void
  onCancel: () => void
  onClose: () => void
  onOpenOutput: (planId: string) => void
}

export function LocalTaskPanel({ plan, progress, result, running, onApprove, onCancel, onClose, onOpenOutput }: LocalTaskPanelProps) {
  const { t } = useTranslation()
  const successCount = result?.artifacts.filter((artifact) => artifact.success).length ?? 0

  return (
    <div className="local-task-backdrop" role="presentation">
      <section className="local-task-panel" role="dialog" aria-modal="true" aria-label={t('localTask.title')}>
        <header>
          <div>
            <span className="local-task-eyebrow">{t('localTask.title')}</span>
            <h2>{result ? t('localTask.resultTitle') : running ? t('localTask.processingTitle') : t('localTask.confirmTitle')}</h2>
          </div>
          {!running && <button className="icon-button" type="button" onClick={onClose}><X size={18} /></button>}
        </header>

        {!result && (
          <>
            <div className="local-task-limit"><ShieldCheck size={18} /><span>{t('localTask.target')} <strong>{plan.targetLabel}</strong></span></div>
            <div className="local-task-file-list">
              {plan.files.map((file) => (
                <div className={`local-task-file ${file.supported ? '' : 'unsupported'}`} key={file.attachmentId}>
                  {file.supported ? <CircleCheck size={17} /> : <TriangleAlert size={17} />}
                  <div><strong>{file.name}</strong><small>{formatBytes(file.originalSize)} · {t(`localTask.actions.${file.action}`)}</small>{file.warning && <p>{file.warning}</p>}</div>
                </div>
              ))}
            </div>
            <div className="local-task-safety"><strong>{t('localTask.safetyTitle')}</strong><span>{t('localTask.safetyDescription', { directory: plan.outputDirectoryName })}</span></div>
            {running && <div className="local-task-progress"><LoaderCircle className="spin" size={18} /><span>{progress?.message ?? t('localTask.preparing')}</span><strong>{progress ? `${progress.current}/${progress.total}` : ''}</strong></div>}
          </>
        )}

        {result && (
          <>
            <div className={`local-task-summary ${result.status}`}><strong>{t('localTask.successCount', { success: successCount, total: result.artifacts.length })}</strong><span>{result.status === 'completed' ? t('localTask.allVerified') : t('localTask.someNeedOtherMethod')}</span></div>
            <div className="local-task-result-list">
              {result.artifacts.map((artifact) => (
                <div className={artifact.success ? 'success' : 'failed'} key={artifact.attachmentId}>
                  {artifact.success ? <CircleCheck size={17} /> : <TriangleAlert size={17} />}
                  <div><strong>{artifact.outputName ?? artifact.sourceName}</strong><small>{formatBytes(artifact.originalSize)}{artifact.outputSize !== undefined ? ` → ${formatBytes(artifact.outputSize)}` : ''}</small><p>{artifact.message}</p></div>
                </div>
              ))}
            </div>
          </>
        )}

        <footer>
          {running && <button className="secondary-action" type="button" onClick={onCancel}>{t('localTask.cancelTask')}</button>}
          {!running && <button className="secondary-action" type="button" onClick={onClose}>{result ? t('common.close') : t('common.cancel')}</button>}
          {!result && <button className="primary-action" disabled={running || !plan.files.some((file) => file.supported)} type="button" onClick={onApprove}>{running ? t('localTask.processing') : t('localTask.start')}</button>}
          {result?.outputDirectory && <button className="primary-action" type="button" onClick={() => onOpenOutput(result.planId)}><FolderOpen size={16} />{t('localTask.openOutput')}</button>}
        </footer>
      </section>
    </div>
  )
}
