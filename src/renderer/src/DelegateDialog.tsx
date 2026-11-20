/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, X } from 'lucide-react'
import type { Assistant } from '@shared/types'
import { AssistantAvatar } from './App'

export interface SeatSnapshot {
  /** Last thing the seat concluded, so the orchestrator does not hand it a duplicate task. */
  conclusion: string
  /** Conversation the conclusion came from. */
  source: string
  openTasks: string
}

export function DelegateDialog({ seat, snapshot, defaultTask = '', onClose, onSend }: {
  seat: Assistant
  snapshot: SeatSnapshot
  defaultTask?: string
  onClose: () => void
  onSend: (input: { task: string; attachConclusion: boolean }) => Promise<void>
}) {
  const { t } = useTranslation()
  const [task, setTask] = useState(defaultTask)
  const [attachConclusion, setAttachConclusion] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !sending) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  const send = async () => {
    if (!task.trim() || sending) return
    setSending(true)
    setError('')
    try {
      await onSend({ task: task.trim(), attachConclusion })
      onClose()
    } catch (reason) {
      setError(String((reason as Error)?.message ?? reason))
    } finally {
      setSending(false)
    }
  }

  return <div className="delegate-scrim" role="presentation" onClick={() => { if (!sending) onClose() }}>
    <div className="delegate-shell" role="dialog" aria-modal="true" aria-label={t('delegate.title')} onClick={(event) => event.stopPropagation()}>
      <header className="delegate-head">
        <AssistantAvatar assistant={seat} />
        <div>
          <strong>{t('delegate.title')}</strong>
          <span>{seat.name} · {seat.title}</span>
        </div>
        <button type="button" onClick={onClose} disabled={sending} title={t('common.close')}><X size={16} /></button>
      </header>

      <label className="delegate-field">
        <span>{t('delegate.task')}</span>
        <textarea value={task} onChange={(event) => setTask(event.target.value)} rows={5}
          placeholder={t('delegate.taskPlaceholder', { seat: seat.name })} autoFocus disabled={sending}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send() } }} />
      </label>

      <section className="delegate-snapshot">
        <div className="delegate-snapshot-title">{t('delegate.snapshot')}</div>
        {snapshot.conclusion
          ? <>
            <p className="delegate-snapshot-source">{t('delegate.from', { source: snapshot.source })}</p>
            <p className="delegate-snapshot-body">{snapshot.conclusion}</p>
          </>
          : <p className="delegate-snapshot-empty">{t('delegate.noConclusion')}</p>}
        {snapshot.openTasks && <p className="delegate-snapshot-open">{t('delegate.openTasks', { value: snapshot.openTasks })}</p>}
        <label className="delegate-attach">
          <input type="checkbox" checked={attachConclusion} onChange={(event) => setAttachConclusion(event.target.checked)} disabled={sending} />
          {t('delegate.attachConclusion')}
        </label>
      </section>

      {error && <p className="delegate-error" role="alert">{error}</p>}

      <footer className="delegate-foot">
        <span>{t('delegate.attachHint')}</span>
        <button type="button" className="delegate-secondary" onClick={onClose} disabled={sending}>{t('common.cancel')}</button>
        <button type="button" className="delegate-primary" onClick={() => void send()} disabled={sending || !task.trim()}>
          <Send size={14} />{sending ? t('delegate.sending') : t('delegate.send')}
        </button>
      </footer>
    </div>
  </div>
}
