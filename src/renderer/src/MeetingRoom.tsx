/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, MessageSquare, RefreshCw, Send } from 'lucide-react'
import type { ConversationWorkspace } from '@shared/types'

interface MeetingPostView { seat: string; at: string; body: string }

export function MeetingRoom({ workspace, assistantName, refreshKey }: {
  workspace?: ConversationWorkspace
  assistantName: string
  refreshKey: string
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
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

  useEffect(() => {
    let cancelled = false
    if (!workspace || !expanded) return
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
  }, [workspace?.rootPath, expanded, refresh, refreshKey])

  const send = async () => {
    if (!workspace || !draft.trim() || sending) return
    setSending(true)
    setError('')
    try {
      const result = await window.gllm.postMeetingMessage({ workspaceRoot: workspace.rootPath, seat: assistantName, content: draft })
      setDraft('')
      setNotice(t('meeting.posted', { at: result.at, bytes: result.bytes }))
      setRefresh(value => value + 1)
    } catch (reason) {
      setError(String((reason as Error)?.message ?? reason))
    } finally {
      setSending(false)
    }
  }

  const ordered = [...posts].reverse()
  const seatLabel = assistantName || t('meeting.currentAssistant')

  return <section className={`meeting-room-panel${expanded ? ' is-expanded' : ''}`} aria-label={t('meeting.aria')}>
    <div className="workspace-files-heading">
      <button className="workspace-files-title" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} title={roomPath}>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<MessageSquare size={14} />
        <strong>{t('meeting.title')}</strong>
        <span>{posts.length > 0 ? t('meeting.postCount', { count: posts.length }) : t('meeting.notLoaded')}</span>
      </button>
      {expanded && <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={!workspace || loading} aria-label={t('meeting.refresh')}><RefreshCw size={13} /></button>}
    </div>
    {expanded && <>
      {!workspace ? <p className="workspace-files-empty">{t('meeting.pickWorkspace')}</p> : <>
        {!tailComplete && <p className="workspace-files-error" role="alert">{t('meeting.tailBroken')}</p>}
        {skipped > 0 && <p className="workspace-files-empty">{t('meeting.skipped', { count: skipped })}</p>}
        <div className="meeting-room-list" aria-busy={loading}>
          {ordered.map((post, index) => <article className="meeting-room-post" key={`${post.at}-${index}`}>
            <header><strong>{post.seat}</strong><time>{post.at}</time></header>
            <p>{post.body}</p>
          </article>)}
          {!loading && ordered.length === 0 && !error && <p className="workspace-files-empty">{t('meeting.empty')}</p>}
        </div>
        <div className="meeting-room-composer">
          <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={4} placeholder={t('meeting.placeholder', { seat: seatLabel })} />
          <div>
            <span>{notice || t('meeting.signature', { seat: seatLabel })}</span>
            <button type="button" onClick={() => void send()} disabled={sending || !draft.trim()}><Send size={13} />{sending ? t('meeting.sending') : t('meeting.send')}</button>
          </div>
        </div>
      </>}
      {error && <p className="workspace-files-error" role="alert">{error}</p>}
    </>}
  </section>
}
