/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpRight, FolderOpen, X } from 'lucide-react'
import type { Assistant, Conversation, SeatContextFiles } from '@shared/types'
import { AssistantAvatar } from './App'

function previewOf(conversation: Conversation): string {
  const lastAssistant = [...conversation.messages].reverse().find((message) => message.role === 'assistant' && message.content.trim())
  const source = lastAssistant?.content ?? [...conversation.messages].reverse().find((message) => message.content.trim())?.content ?? ''
  return source.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function stamp(at: number): string {
  const date = new Date(at)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function fileSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

export function SeatDrawer({ seat, conversations, onClose, onOpenConversation, onEnterSeat, onClearPrompt }: {
  seat: Assistant | null
  conversations: Conversation[]
  onClose: () => void
  onOpenConversation: (conversationId: string, assistantId: string) => void
  onEnterSeat: (seat: Assistant) => void
  /** Drops the imported copy of AGENTS.md so the file in the folder is the only persona. */
  onClearPrompt: (seat: Assistant) => void
}) {
  const { t } = useTranslation()
  const [context, setContext] = useState<SeatContextFiles | null>(null)
  const [contextError, setContextError] = useState('')
  const seatRoot = seat?.workspaceRoot?.trim() ?? ''

  useEffect(() => {
    if (!seatRoot) {
      setContext(null)
      return
    }
    let cancelled = false
    window.gllm.describeSeatContext({ workspaceRoot: seatRoot, systemPrompt: seat?.systemPrompt ?? '' })
      .then((result) => {
        if (cancelled) return
        setContext(result)
        setContextError('')
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setContext(null)
        setContextError(String((reason as Error)?.message ?? reason))
      })
    return () => { cancelled = true }
  }, [seatRoot, seat?.systemPrompt])

  useEffect(() => {
    if (!seat) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [seat, onClose])

  if (!seat) return null
  const rows = conversations
    .filter((conversation) => conversation.assistantId === seat.id)
    .sort((first, second) => second.updatedAt - first.updatedAt)

  return <div className="seat-drawer-scrim" role="presentation" onClick={onClose}>
    <aside className="seat-drawer" role="dialog" aria-modal="true" aria-label={seat.name} onClick={(event) => event.stopPropagation()}>
      <header className="seat-drawer-head">
        <AssistantAvatar assistant={seat} />
        <div className="seat-drawer-identity">
          <strong>{seat.name}</strong>
          <span>{seat.title}</span>
        </div>
        <button type="button" onClick={onClose} title={t('common.close')}><X size={16} /></button>
      </header>

      <div className="seat-drawer-scroll">
        <div className="seat-drawer-section-title">
          <span>{t('seatDrawer.config')}</span>
        </div>
        {!seatRoot && <p className="seat-drawer-hint">{t('seatDrawer.noWorkspace')}</p>}
        {seatRoot && <div className="seat-drawer-config">
          <span>{t('seatDrawer.directory')}</span>
          <code title={seatRoot}>{seatRoot}</code>
          <button type="button" title={t('seatDrawer.openDirectory')} onClick={() => void window.gllm.openWorkspaceDirectory(seatRoot)}><FolderOpen size={13} /></button>
        </div>}
        {seatRoot && context?.files.map((file) => <div className="seat-drawer-config" key={file.path}>
          <span>{file.label === 'AGENTS.md' ? t('seatDrawer.persona') : t('seatDrawer.memory')}</span>
          <code title={file.path}>{file.label} · {fileSize(file.bytes)}</code>
        </div>)}
        {seatRoot && context && context.files.length === 0 && <p className="seat-drawer-hint">{t('seatDrawer.noFiles')}</p>}
        {context?.duplicatedPrompt && <div className="seat-drawer-warn">
          <span>{t('seatDrawer.duplicatePrompt')}</span>
          <button type="button" onClick={() => onClearPrompt(seat)}>{t('seatDrawer.clearPrompt')}</button>
        </div>}
        {contextError && <p className="seat-drawer-hint">{contextError}</p>}

        <div className="seat-drawer-section-title">
          <span>{t('seatDrawer.conversations')}</span>
          <span className="seat-drawer-count">{rows.length}</span>
        </div>
        {rows.length === 0 && <p className="seat-drawer-hint">{t('seatDrawer.empty')}</p>}
        {rows.map((conversation) => <button
          key={conversation.id}
          type="button"
          className="seat-drawer-row"
          onClick={() => onOpenConversation(conversation.id, seat.id)}
        >
          <span className="seat-drawer-row-head">
            <strong>{conversation.title}</strong>
            <time>{stamp(conversation.updatedAt)}</time>
          </span>
          <span className="seat-drawer-row-preview">{previewOf(conversation) || t('seatDrawer.noContent')}</span>
          <span className="seat-drawer-row-meta">{t('seatDrawer.messageCount', { count: conversation.messages.length })}</span>
        </button>)}
      </div>

      <footer className="seat-drawer-foot">
        <button type="button" className="seat-drawer-secondary" onClick={() => { onClose(); if (rows[0]) onOpenConversation(rows[0].id, seat.id); else onEnterSeat(seat) }}>
          <ArrowUpRight size={14} />{t('seatDrawer.enter')}
        </button>
      </footer>
    </aside>
  </div>
}
