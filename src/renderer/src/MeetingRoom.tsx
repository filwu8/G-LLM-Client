/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownRight, MessageSquare, RefreshCw, Send, X } from 'lucide-react'
import type { ConversationWorkspace, MeetingSeatTurnResult } from '@shared/types'

interface MeetingPostView { floor: number; seat: string; at: string; body: string }
interface MeetingSeat { id: string; name: string }

/** A reply is written as `> 回复 #<floor> <seat>` above the body, so the room
 * file stays plain text while the UI can still show thread context. */
const QUOTE_PATTERN = /^>\s*回复\s*#?(\d+)([^\n]*)\n?/

function seatHue(seat: string): number {
  let hash = 0
  for (let index = 0; index < seat.length; index += 1) hash = (hash * 31 + seat.charCodeAt(index)) % 360
  return hash
}

function PostBody({ body }: { body: string }) {
  const match = QUOTE_PATTERN.exec(body)
  if (!match) return <div className="forum-post-body">{body}</div>
  const quoted = match[1]
  const rest = body.slice(match[0].length).replace(/^\n+/, '')
  return <>
    <div className="forum-post-quote">{match[2]?.trim() || `#${quoted}`}</div>
    <div className="forum-post-body">{rest}</div>
  </>
}

export function MeetingRoomDialog({ open, onClose, workspace, assistantName, seats, onCallSeat, refreshKey }: {
  open: boolean
  onClose: () => void
  workspace?: ConversationWorkspace
  assistantName: string
  /** Seats that can be called: only the ones with their own working directory. */
  seats: MeetingSeat[]
  onCallSeat: (seatId: string) => Promise<MeetingSeatTurnResult>
  refreshKey: string
}) {
  const { t } = useTranslation()
  const [posts, setPosts] = useState<MeetingPostView[]>([])
  const [roomPath, setRoomPath] = useState('')
  const [tailComplete, setTailComplete] = useState(true)
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [callingSeat, setCallingSeat] = useState('')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    if (!workspace || !open) return
    setLoading(true)
    window.gllm.readMeetingRoom(workspace.rootPath).then(result => {
      if (cancelled) return
      setPosts(result.posts)
      setRoomPath(result.path)
      setTailComplete(result.tailComplete)
      setSkipped(result.skipped)
      setError('')
    }).catch((reason: unknown) => {
      if (cancelled) return
      setPosts([])
      setError(String((reason as Error)?.message ?? reason))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspace?.rootPath, open, refresh, refreshKey])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Seats post on their own schedule, so the room has to keep up without a manual click.
  useEffect(() => {
    if (!open || !workspace) return
    const timer = window.setInterval(() => setRefresh(value => value + 1), 8000)
    return () => window.clearInterval(timer)
  }, [open, workspace?.rootPath])

  const toggleSeat = (seatId: string) => {
    setPicked(current => current.includes(seatId) ? current.filter(item => item !== seatId) : [...current, seatId])
  }

  const callSeats = async () => {
    if (!workspace || callingSeat || picked.length === 0) return
    setError('')
    const failures: string[] = []
    for (const seatId of picked) {
      const seat = seats.find(item => item.id === seatId)
      setCallingSeat(seat?.name ?? seatId)
      try {
        const result = await onCallSeat(seatId)
        if (result.ok) setNotice(t('meeting.seatReplied', { seat: result.seat }))
        else failures.push(t('meeting.seatReplyFailed', { seat: result.seat, error: result.error ?? '' }))
      } catch (reason) {
        failures.push(t('meeting.seatReplyFailed', { seat: seat?.name ?? seatId, error: String((reason as Error)?.message ?? reason) }))
      }
      // Refresh between seats so the next one reads the post that just landed.
      setRefresh(value => value + 1)
    }
    setCallingSeat('')
    setError(failures.join('；'))
  }

  const send = async () => {
    if (!workspace || !draft.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const result = await window.gllm.postMeetingMessage({ workspaceRoot: workspace.rootPath, seat: assistantName, content: draft })
      setDraft('')
      setNotice(t('meeting.posted', { at: result.at, bytes: result.bytes }))
      setRefresh(value => value + 1)
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0 }))
    } catch (reason) {
      setError(String((reason as Error)?.message ?? reason))
    } finally {
      setSending(false)
    }
  }

  function replyTo(post: MeetingPostView) {
    setDraft(current => `> 回复 #${post.floor} ${post.seat}\n\n${current.replace(QUOTE_PATTERN, '')}`)
    composerRef.current?.focus()
  }

  if (!open) return null
  const ordered = [...posts].reverse()
  const seatLabel = assistantName || t('meeting.currentAssistant')

  return <div className="forum-overlay" role="presentation" onClick={onClose}>
    <div className="forum-shell" role="dialog" aria-modal="true" aria-label={t('meeting.aria')} onClick={event => event.stopPropagation()}>
      <header className="forum-head">
        <div className="forum-head-title">
          <MessageSquare size={17} />
          <h2>{t('meeting.title')}</h2>
          <span className="forum-head-count">{t('meeting.postCount', { count: posts.length })}</span>
        </div>
        <div className="forum-head-actions">
          <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={!workspace || loading} title={t('meeting.refresh')}><RefreshCw size={15} /></button>
          <button type="button" onClick={onClose} title={t('common.close')}><X size={16} /></button>
        </div>
      </header>

      <div className="forum-scroll" ref={listRef} aria-busy={loading}>
        {!workspace && <p className="forum-hint">{t('meeting.pickWorkspace')}</p>}
        {workspace && !tailComplete && <p className="forum-warn" role="alert">{t('meeting.tailBroken')}</p>}
        {workspace && skipped > 0 && <p className="forum-hint">{t('meeting.skipped', { count: skipped })}</p>}
        {workspace && ordered.map(post => <article className="forum-post" key={post.floor}>
          <div className="forum-post-avatar" style={{ background: `hsl(${seatHue(post.seat)} 50% 44%)` }} aria-hidden="true">{post.seat.slice(0, 1)}</div>
          <div className="forum-post-main">
            <div className="forum-post-meta">
              <strong>{post.seat}</strong>
              <time>{post.at}</time>
              <span className="forum-post-floor">{post.floor}楼</span>
            </div>
            <PostBody body={post.body} />
            <div className="forum-post-actions">
              <button type="button" onClick={() => replyTo(post)}><CornerDownRight size={12} />{t('meeting.reply')}</button>
            </div>
          </div>
        </article>)}
        {workspace && !loading && ordered.length === 0 && !error && <p className="forum-hint">{t('meeting.empty')}</p>}
        {error && <p className="forum-warn" role="alert">{error}</p>}
      </div>

      <footer className="forum-composer">
        {seats.length === 0
          ? <p className="forum-hint">{t('meeting.noSeats')}</p>
          : <div className="forum-seats" title={t('meeting.callSeatsHint')}>
            <span className="forum-seats-label">{t('meeting.pickSeats')}</span>
            {seats.map(seat => (
              <button key={seat.id} type="button" className={picked.includes(seat.id) ? 'on' : ''} disabled={Boolean(callingSeat)}
                onClick={() => toggleSeat(seat.id)}>{seat.name}</button>
            ))}
            <button type="button" className="forum-seats-call" disabled={picked.length === 0 || Boolean(callingSeat)}
              onClick={() => void callSeats()}>
              {callingSeat ? t('meeting.callingSeats', { seat: callingSeat }) : t('meeting.callSeats')}
            </button>
          </div>}
        <textarea ref={composerRef} value={draft} onChange={event => setDraft(event.target.value)} rows={3}
          placeholder={t('meeting.placeholder', { seat: seatLabel })} disabled={!workspace || sending}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send() } }} />
        <div className="forum-composer-bar">
          <span title={roomPath}>{notice || t('meeting.signature', { seat: seatLabel })}</span>
          <button type="button" onClick={() => void send()} disabled={sending || !draft.trim() || !workspace}>
            <Send size={14} />{sending ? t('meeting.sending') : t('meeting.send')}
          </button>
        </div>
      </footer>
    </div>
  </div>
}
