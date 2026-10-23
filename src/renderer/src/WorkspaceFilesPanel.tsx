/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, FolderOpen, Paperclip, RefreshCw, Settings, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConversationWorkspace, WorkspaceFileEntry } from '@shared/types'

export function WorkspaceFilesPanel({ workspace, refreshKey, busy, onPick, onAttach, onManage }: {
  workspace?: ConversationWorkspace; refreshKey: string; busy: boolean
  onPick: () => void; onAttach: (path: string) => void; onManage: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const [path, setPath] = useState('.')
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([])
  const [error, setError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(false)
  useEffect(() => { setPath('.'); setEntries([]) }, [workspace?.rootPath])
  useEffect(() => {
    let cancelled = false
    if (!workspace || !expanded) return
    setLoading(true)
    window.gllm.listWorkspaceFiles(workspace.rootPath, path).then(result => {
      if (cancelled) return
      setEntries(result.entries); setTruncated(result.truncated); setError('')
    }).catch(reason => { if (!cancelled) { setEntries([]); setError(String(reason.message ?? reason)) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspace?.rootPath, path, expanded, refresh, refreshKey])
  return <section className="workspace-files-panel" aria-label={t('workspaceFiles.title')}>
    <div className="workspace-files-heading">
      <button className="workspace-files-title" type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} title={workspace?.rootPath}>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<FolderOpen size={16} />
        <strong>{workspace?.displayName ?? t('workspaceFiles.title')}</strong>
        <span>{workspace?.projectId ? t('workspaceFiles.projectFolder') : t('workspaceFiles.sessionFolder')}</span>
      </button>
      <button type="button" onClick={onPick} disabled={busy} title={t('workspaceFiles.add')}><Upload size={15} /><span>{t('workspaceFiles.add')}</span></button>
      <button type="button" onClick={() => setRefresh(value => value + 1)} disabled={!workspace || loading} aria-label={t('workspaceFiles.refresh')}><RefreshCw size={15} /></button>
      <button type="button" onClick={onManage} title={t('workspaceFiles.manage')} aria-label={t('workspaceFiles.manage')}><Settings size={15} /></button>
    </div>
    {expanded && <>
      {!workspace ? <p className="workspace-files-empty">{t('workspaceFiles.startHint')}</p> : <>
        {path !== '.' && <button className="workspace-files-parent" type="button" onClick={() => setPath(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.')}>
          ← {t('workspaceFiles.parent')} · {path}
        </button>}
        <div className="workspace-files-list" aria-busy={loading}>
          {entries.map(entry => <div className="workspace-files-entry" key={entry.relativePath} title={entry.relativePath}>
            <button type="button" disabled={busy && !entry.directory} onClick={() => entry.directory ? setPath(entry.relativePath) : onAttach(entry.relativePath)}>
              {entry.directory ? <FolderOpen size={15} /> : <FileText size={15} />}<span>{entry.name}</span>
              {!entry.directory && <Paperclip size={13} />}
            </button>
          </div>)}
          {!loading && !error && entries.length === 0 && <p className="workspace-files-empty">{t('workspaceFiles.empty')}</p>}
        </div>
        {truncated && <p className="workspace-files-empty">{t('workspaceFiles.truncated')}</p>}
      </>}
      {error && <p className="workspace-files-error" role="alert">{error}</p>}
      <p className="workspace-files-hint">{t('workspaceFiles.dropHint')}</p>
    </>}
  </section>
}
