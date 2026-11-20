/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, CornerDownRight, MessageSquare, RefreshCw, Send } from 'lucide-react'
import type { ConversationWorkspace } from '@shared/types'

interface MeetingPostView { floor: number; seat: string; at: string; body: string }

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
  if (!match) return <p className="meeting-room-post-body">{body}</p>
  const quoted = match[1]
  const rest = body.slice(match[0].length).replace(/^\n+/, '')
  return <>
    <p className="meeting-room-quote">#{quoted}</p>
    <p className="meeting-room-post-body">{rest}</p>
  </>
}

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
  const composerRef = useRef<HTMLTextAreaElement>(null)

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

  function replyTo(post: MeetingPostView) {
    setDraft(current => `> 回复 #${post.floor} ${post.seat}\n\n${current.replace(QUOTE_PATTERN, '')}`)
    composerRef.current?.focus()
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
          {ordered.map(post => <article className="meeting-room-post" key={post.floor}>
            <header>
              <span className="meeting-room-avatar" style={{ background: `hsl(${seatHue(post.seat)} 52% 42%)` }} aria-hidden="true">{post.seat.slice(0, 1)}</span>
              <strong>{post.seat}</strong>
              <time>{post.at}</time>
              <span className="meeting-room-floor">#{post.floor}</span>
            </header>
            <PostBody body={post.body} />
            <footer>
              <button type="button" onClick={() => replyTo(post)}><CornerDownRight size={12} />{t('meeting.reply')}</button>
            </footer>
          </article>)}
          {!loading && ordered.length === 0 && !error && <p className="workspace-files-empty">{t('meeting.empty')}</p>}
        </div>
        <div className="meeting-room-composer">
          <textarea ref={composerRef} value={draft} onChange={event => setDraft(event.target.value)} rows={4} placeholder={t('meeting.placeholder', { seat: seatLabel })} />
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
