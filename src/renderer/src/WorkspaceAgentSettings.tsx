/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Plus, Trash2 } from 'lucide-react'
import type { ConversationWorkspace } from '@shared/types'
export type WorkspaceAgentSettings = Pick<ConversationWorkspace, 'nativeExecution' | 'loadAgentsMd' | 'envNames' | 'executionMode' | 'sandboxNetwork'>
interface VariableRow { name: string; description: string; configured: boolean; value: string; enabled: boolean }
export function WorkspaceAgentSettingsDialog({ workspace, onSave, onClose }: {
  workspace: ConversationWorkspace; onSave: (settings: WorkspaceAgentSettings) => Promise<void>; onClose: () => void
}) {
  const { t } = useTranslation()
  const [nativeExecution, setNativeExecution] = useState(workspace.nativeExecution === true)
  const [executionMode, setExecutionMode] = useState<'sandbox' | 'host'>(workspace.executionMode === 'host' ? 'host' : 'sandbox')
  const [sandboxNetwork, setSandboxNetwork] = useState(workspace.sandboxNetwork === true)
  const [loadAgentsMd, setLoadAgentsMd] = useState(workspace.loadAgentsMd !== false)
  const [rows, setRows] = useState<VariableRow[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [status, setStatus] = useState<Awaited<ReturnType<typeof window.gllm.getWorkspaceAgentSettings>>>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checkRevision, setCheckRevision] = useState(0)
  const [checking, setChecking] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof window.gllm.checkWorkspaceExecution>>>()
  const [checkError, setCheckError] = useState('')
  useEffect(() => {
    let active = true
    setDiagnostics(undefined); setCheckError('')
    if (!nativeExecution) { setChecking(false); return }
    setChecking(true)
    window.gllm.checkWorkspaceExecution(workspace.rootPath, { executionMode, sandboxNetwork }).then(result => {
      if (active) setDiagnostics(result)
    }).catch(reason => { if (active) setCheckError(String(reason)) }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [workspace.rootPath, nativeExecution, executionMode, sandboxNetwork, checkRevision])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    window.gllm.getWorkspaceAgentSettings(workspace.rootPath).then(value => {
      if (!active) return
      setStatus(value)
      const names = [...new Set([...(workspace.envNames ?? []), ...value.variables.map(item => item.name), ...value.suggestedNames])]
      setRows(names.map(name => ({ name, description: value.variables.find(item => item.name === name)?.description ?? '', configured: value.variables.find(item => item.name === name)?.configured ?? false, value: '', enabled: workspace.envNames?.includes(name) ?? false })))
    }).catch(reason => { if (active) setError(String(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workspace.rootPath])
  const valid = rows.length <= 32 && rows.every(row => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(row.name)) && new Set(rows.map(row => row.name)).size === rows.length
  const patch = (index: number, change: Partial<VariableRow>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...change } : row))
  async function save() {
    if (!valid || saving || loading) return
    setSaving(true); setError('')
    try {
      const updates = rows.filter(row => row.value !== '').map(row => ({ name: row.name, description: row.description, value: row.value }))
      if (updates.length || removed.length) await window.gllm.saveWorkspaceVariables(workspace.rootPath, [...updates, ...[...new Set(removed)].filter(name => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) && !rows.some(row => row.name === name)).map(name => ({ name, description: '', remove: true }))])
      setRows(current => current.map(row => ({ ...row, value: '' })))
      await onSave({ nativeExecution, loadAgentsMd, envNames: rows.filter(row => row.enabled).map(row => row.name), executionMode, sandboxNetwork })
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  return <div className="assistant-modal-backdrop workspace-approval-backdrop">
    <section className="workspace-approval-dialog workspace-agent-settings" role="dialog" aria-modal="true" aria-labelledby="workspace-agent-settings-title">
      <header><div><strong id="workspace-agent-settings-title">{t('workspace.agentSettings')}</strong><small>{workspace.rootPath}</small></div><button className="icon-button" aria-label={t('common.close')} onClick={onClose} disabled={saving}><X size={18} /></button></header>
      <label><input type="checkbox" checked={loadAgentsMd} onChange={event => setLoadAgentsMd(event.target.checked)} />{t('workspace.agentLoadRules')}</label>
      <p>{t('workspace.agentRulesDescription')}</p>
      <label><input type="checkbox" checked={nativeExecution} onChange={event => setNativeExecution(event.target.checked)} />{t('workspace.agentNative')}</label>
      <p>{t('workspace.agentApprovalHint')}</p>
      <label>{t('workspace.agentExecutionMode')}<select value={executionMode} onChange={event => setExecutionMode(event.target.value as 'sandbox' | 'host')}><option value="sandbox">{t('workspace.agentSandbox')}</option><option value="host">{t('workspace.agentHost')}</option></select></label>
      <p>{executionMode === 'sandbox' ? t('workspace.agentSandboxBoundary') : t('workspace.agentNativeDescription')}</p>
      {executionMode === 'sandbox' && <>
        <p role="status">{status ? `${status.sandbox.backend} · ${t(status.sandbox.available ? 'workspace.agentBackendPresent' : 'workspace.agentBackendMissing')}` : t('workspace.agentLoading')}</p>
        {status && !status.sandbox.available && <p>{status.sandbox.detail}</p>}
        <label><input type="checkbox" checked={sandboxNetwork} onChange={event => setSandboxNetwork(event.target.checked)} />{t('workspace.agentNetworkOn')}</label>
        <p>{t('workspace.agentNetworkDescription')}</p>
      </>}
      {nativeExecution && <section className="workspace-execution-check" aria-live="polite">
        <p><strong>{t('workspace.checkTitle')}</strong></p>
        <p>{t('workspace.checkScope')}</p>
        {checking && <p role="status">{t('workspace.checkRunning')}</p>}
        {checkError && <p role="alert">{checkError}</p>}
        {diagnostics && <>
          <p><strong>{t(diagnostics.checks.some(item => item.status === 'failed') ? 'workspace.checkFailed' : 'workspace.checkPassed')}</strong></p>
          {diagnostics.checks.map(item => <div key={item.id}>
            <p>{t(`workspace.checkItems.${item.id}`)}: <strong>{t(`workspace.checkStates.${item.status}`)}</strong></p>
            {item.detail && <details><summary>{t('workspace.checkDetails')}</summary><pre className="workspace-code-preview">{item.detail}</pre></details>}
          </div>)}
          {diagnostics.checks.some(item => item.status === 'failed') && <p>{t('workspace.checkRepair')}</p>}
        </>}
        <button className="secondary-action" type="button" disabled={checking} onClick={() => setCheckRevision(value => value + 1)}>{t('workspace.checkAgain')}</button>
      </section>}
      <p><strong>{t('workspace.agentVariables')}</strong></p>
      <p>{t('workspace.agentVariablesDescription')}</p>
      {status && !status.encryptionAvailable && <p role="alert">{t('workspace.agentEncryptionUnavailable')}</p>}
      <div className="workspace-variable-rows">
        {rows.map((row, index) => <div className="workspace-variable-row" key={index}>
          <input type="checkbox" checked={row.enabled} onChange={event => patch(index, { enabled: event.target.checked })} aria-label={`${t('workspace.agentEnableVariable')} ${row.name}`} />
          <input type="text" value={row.name} readOnly={row.configured} onChange={event => patch(index, { name: event.target.value.trim() })} placeholder="ERP_API_KEY" aria-label={t('workspace.agentVariableName')} title={row.description || row.name} aria-description={row.description || undefined} spellCheck={false} autoComplete="off" />
          <input type="password" value={row.value} disabled={!status?.encryptionAvailable} onChange={event => patch(index, { value: event.target.value })} placeholder={t(row.configured ? 'workspace.agentVariableConfigured' : 'workspace.agentVariableValue')} aria-label={`${t('workspace.agentVariableValue')} ${row.name}`} autoComplete="new-password" spellCheck={false} />
          <button className="icon-button" aria-label={`${t('workspace.agentRemoveVariable')} ${row.name}`} disabled={!status?.encryptionAvailable} onClick={() => { setRemoved(current => [...current, row.name]); setRows(current => current.filter((_, i) => i !== index)) }}><Trash2 size={16} /></button>
        </div>)}
      </div>
      <button className="secondary-action" type="button" disabled={loading || rows.length >= 32} onClick={() => setRows(current => [...current, { name: '', description: '', configured: false, value: '', enabled: true }])}><Plus size={14} />{t('workspace.agentAddVariable')}</button>
      {!valid && <p role="alert">{t('workspace.agentEnvInvalid')}</p>}
      {error && <p role="alert">{error}</p>}
      <footer><button className="secondary-action" disabled={saving} onClick={onClose}>{t('common.cancel')}</button><button className="primary-action" disabled={!valid || saving || loading} onClick={() => void save()}>{t('common.save')}</button></footer>
    </section>
  </div>
}
