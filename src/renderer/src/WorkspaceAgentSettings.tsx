/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { startTransition, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Plus, Trash2 } from 'lucide-react'
import type { ConversationWorkspace } from '@shared/types'
export type WorkspaceAgentSettings = Pick<ConversationWorkspace, 'nativeExecution' | 'loadAgentsMd' | 'envNames' | 'executionMode' | 'sandboxNetwork' | 'computerAccess' | 'browserAccess' | 'computerWindowAccess' | 'browserWindowAccess' | 'harness'>

/** Where a saved execution profile is applied: this conversation only, every
 * conversation of the current assistant, or the assistant plus its child seats. */
export type WorkspaceApplyScope = 'conversation' | 'assistant' | 'children'
interface VariableRow { name: string; description: string; configured: boolean; value: string; enabled: boolean }

type WorkspaceAgentSettingsPayload = Awaited<ReturnType<typeof window.gllm.getWorkspaceAgentSettings>>

/**
 * The dialog used to mount with empty state, request the settings, and then repaint
 * the whole form when the IPC landed. Measured on a cold start that repaint is a
 * ~60ms long frame about 120ms after the click — the pause users describe as "the
 * first open is slow". Prefetching lets the first paint already carry the real data,
 * so there is no second render at all.
 */
const settingsPrefetch = new Map<string, WorkspaceAgentSettingsPayload>()
const settingsInFlight = new Map<string, Promise<WorkspaceAgentSettingsPayload>>()

function requestWorkspaceAgentSettings(rootPath: string): Promise<WorkspaceAgentSettingsPayload> {
  const existing = settingsInFlight.get(rootPath)
  if (existing) return existing
  const promise = window.gllm.getWorkspaceAgentSettings(rootPath)
    .then((value) => {
      settingsPrefetch.set(rootPath, value)
      return value
    })
    .finally(() => { settingsInFlight.delete(rootPath) })
  settingsInFlight.set(rootPath, promise)
  return promise
}

export function prefetchWorkspaceAgentSettings(rootPath?: string): void {
  if (!rootPath || settingsPrefetch.has(rootPath)) return
  void requestWorkspaceAgentSettings(rootPath).catch(() => {})
}

type ExecutionCheckResult = Awaited<ReturnType<typeof window.gllm.checkWorkspaceExecution>>

const executionCheckCache = new Map<string, ExecutionCheckResult>()
const executionCheckInFlight = new Map<string, Promise<ExecutionCheckResult>>()

function executionCheckKey(rootPath: string, mode: string, sandboxNetwork: boolean): string {
  return `${rootPath}|${mode}|${sandboxNetwork ? 1 : 0}`
}

function requestWorkspaceExecutionCheck(
  rootPath: string,
  mode: string,
  sandboxNetwork: boolean
): Promise<ExecutionCheckResult> {
  const executionMode = mode === 'host' ? 'host' : 'sandbox'
  const network = sandboxNetwork === true
  const key = executionCheckKey(rootPath, executionMode, network)
  const existing = executionCheckInFlight.get(key)
  if (existing) return existing
  const promise = window.gllm.checkWorkspaceExecution(rootPath, { executionMode, sandboxNetwork: network })
    .then((result) => {
      executionCheckCache.set(key, result)
      return result
    })
    .finally(() => { executionCheckInFlight.delete(key) })
  executionCheckInFlight.set(key, promise)
  return promise
}

/**
 * Runs the sandbox probe before the dialog opens. `checkWorkspaceExecution` spawns
 * work in the main process and its result repaints the diagnostics list, which is
 * measured as a long frame just after the click on a cold start.
 */
export function prefetchWorkspaceExecutionCheck(rootPath?: string, mode?: string, sandboxNetwork?: boolean): void {
  if (!rootPath) return
  const key = executionCheckKey(rootPath, mode === 'host' ? 'host' : 'sandbox', sandboxNetwork === true)
  if (executionCheckCache.has(key)) return
  void requestWorkspaceExecutionCheck(rootPath, mode ?? 'sandbox', sandboxNetwork === true).catch(() => {})
}

function buildVariableRows(value: WorkspaceAgentSettingsPayload, workspace: ConversationWorkspace): VariableRow[] {  const names = [...new Set([...(workspace.envNames ?? []), ...value.variables.map(item => item.name), ...value.suggestedNames])]
  return names.map(name => ({
    name,
    description: value.variables.find(item => item.name === name)?.description ?? '',
    configured: value.variables.find(item => item.name === name)?.configured ?? false,
    value: '',
    enabled: workspace.envNames?.includes(name) ?? false
  }))
}

export function DesktopAccessSetupDialog({ workspace, onSave, onClose }: { workspace?: ConversationWorkspace; onSave: (workspace: ConversationWorkspace, scope?: WorkspaceApplyScope) => Promise<void>; onClose: () => void }) {
  const { t } = useTranslation()
  const [candidate, setCandidate] = useState(workspace)
  const [error, setError] = useState('')
  useEffect(() => {
    if (workspace) return
    let active = true
    window.gllm.createAgentWorkspace().then(rootPath => {
      if (active) setCandidate({ rootPath, kind: 'managed', displayName: t('workspace.desktopAccess'), permission: 'read-write', approvalMode: 'ask', grantedAt: Date.now(), lastVerifiedAt: Date.now() })
    }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [workspace])
  if (!candidate) return <div className="assistant-modal-backdrop workspace-approval-backdrop"><section className="workspace-approval-dialog" role="dialog" aria-modal="true"><p role="status">{error || t('workspace.agentLoading')}</p><button type="button" onClick={onClose}>{t('common.close')}</button></section></div>
  return <WorkspaceAgentSettingsDialog workspace={candidate} onClose={onClose} onSave={(settings, scope) => onSave({ ...candidate, ...settings, lastVerifiedAt: Date.now() }, scope)} />
}

export function WorkspaceAgentSettingsDialog({ workspace, onSave, onClose }: {
  workspace: ConversationWorkspace; onSave: (settings: WorkspaceAgentSettings, scope?: WorkspaceApplyScope) => Promise<void>; onClose: () => void
}) {
  const { t } = useTranslation()
  const prefetched = settingsPrefetch.get(workspace.rootPath)
  const [nativeExecution, setNativeExecution] = useState(workspace.nativeExecution === true)
  const [applyScope, setApplyScope] = useState<WorkspaceApplyScope>('conversation')
  const [computerAccess, setComputerAccess] = useState(workspace.computerAccess === true)
  const [browserAccess, setBrowserAccess] = useState(workspace.browserAccess === true)
  const [computerWindowAccess, setComputerWindowAccess] = useState(workspace.computerWindowAccess === true)
  const [browserWindowAccess, setBrowserWindowAccess] = useState(workspace.browserWindowAccess === true)
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null)
  useEffect(() => {
    if (window.gllm.platform !== 'darwin') return
    let active = true
    window.gllm.checkComputerAccessibility().then(value => { if (active) setAccessibilityGranted(value) }).catch(() => {})
    return () => { active = false }
  }, [])
  const [executionMode, setExecutionMode] = useState<'sandbox' | 'host'>(workspace.executionMode === 'host' ? 'host' : 'sandbox')
  const [sandboxNetwork, setSandboxNetwork] = useState(workspace.sandboxNetwork === true)
  const [loadAgentsMd, setLoadAgentsMd] = useState(workspace.loadAgentsMd !== false)
  const [harnessEnabled, setHarnessEnabled] = useState(workspace.harness?.enabled === true)
  const [harnessDelegateAll, setHarnessDelegateAll] = useState(workspace.harness?.delegateAll === true)
  const [rows, setRows] = useState<VariableRow[]>(() => prefetched ? buildVariableRows(prefetched, workspace) : [])
  const [removed, setRemoved] = useState<string[]>([])
  const [status, setStatus] = useState<WorkspaceAgentSettingsPayload | undefined>(prefetched)
  const [loading, setLoading] = useState(!prefetched)
  const [saving, setSaving] = useState(false)
  const [checkRevision, setCheckRevision] = useState(0)
  const [checking, setChecking] = useState(false)
  const [diagnostics, setDiagnostics] = useState<Awaited<ReturnType<typeof window.gllm.checkWorkspaceExecution>>>()
  const [checkError, setCheckError] = useState('')
  useEffect(() => {
    let active = true
    setCheckError('')
    if (!nativeExecution) { setChecking(false); setDiagnostics(undefined); return }
    // A cached probe result means the dialog can paint its diagnostics immediately.
    // See prefetchWorkspaceExecutionCheck: without it the check lands ~120ms after
    // the click and repaints the list as two long frames.
    const key = executionCheckKey(workspace.rootPath, executionMode, sandboxNetwork)
    const cached = checkRevision === 0 ? executionCheckCache.get(key) : undefined
    if (cached) {
      setDiagnostics(cached)
      setChecking(false)
      return () => { active = false }
    }
    setDiagnostics(undefined)
    setChecking(true)
    requestWorkspaceExecutionCheck(workspace.rootPath, executionMode, sandboxNetwork).then(result => {
      // Filling in diagnostics is not urgent: a transition keeps the update
      // interruptible so it cannot freeze the dialog while the user is reading it.
      if (active) startTransition(() => setDiagnostics(result))
    }).catch(reason => { if (active) setCheckError(String(reason)) }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [workspace.rootPath, nativeExecution, executionMode, sandboxNetwork, checkRevision])
  const [error, setError] = useState('')
  useEffect(() => {
    // Prefetched before the dialog opened: the first paint is already final, so skip
    // the request entirely instead of repainting the form a moment later.
    if (settingsPrefetch.has(workspace.rootPath)) return
    let active = true
    requestWorkspaceAgentSettings(workspace.rootPath).then(value => {
      if (!active) return
      setStatus(value)
      setRows(buildVariableRows(value, workspace))
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
      await onSave({ nativeExecution, computerAccess, browserAccess, computerWindowAccess, browserWindowAccess, loadAgentsMd, envNames: rows.filter(row => row.enabled).map(row => row.name), executionMode, sandboxNetwork, harness: { ...(workspace.harness ?? {}), enabled: harnessEnabled, delegateAll: harnessDelegateAll } }, applyScope)
      // Saved values invalidate the prefetch: refresh it so the next open is fast
      // and shows the new state.
      settingsPrefetch.delete(workspace.rootPath)
      prefetchWorkspaceAgentSettings(workspace.rootPath)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setSaving(false) }
  }
  return <div className="assistant-modal-backdrop workspace-approval-backdrop">
    <section className="workspace-approval-dialog workspace-agent-settings" role="dialog" aria-modal="true" aria-labelledby="workspace-agent-settings-title">
      <header><div><strong id="workspace-agent-settings-title">{t('workspace.agentSettings')}</strong><small>{workspace.rootPath}</small></div><button className="icon-button" aria-label={t('common.close')} onClick={onClose} disabled={saving}><X size={18} /></button></header>
      <p><strong>{t('workspace.desktopAccess')}</strong> · {window.gllm.platform === 'darwin' ? 'macOS' : window.gllm.platform === 'win32' ? 'Windows' : 'Linux'}</p>
      {window.gllm.platform === 'win32' && <>
        <label><input type="checkbox" checked={browserWindowAccess} onChange={event => setBrowserWindowAccess(event.target.checked)} />{t('workspace.browserWindowAccess')}</label>
        <p>{t('workspace.browserWindowAccessDescription')}</p>
        <label><input type="checkbox" checked={computerWindowAccess} onChange={event => setComputerWindowAccess(event.target.checked)} />{t('workspace.computerWindowAccess')}</label>
        <p>{t('workspace.computerWindowAccessDescription')}</p>
        <p>{t('workspace.windowDataNotice')}</p>
      </>}
      <label><input type="checkbox" checked={computerAccess} onChange={event => setComputerAccess(event.target.checked)} />{t('workspace.computerAccess')}</label>
      <p>{t('workspace.computerAccessDescription')}</p>
      {computerAccess && window.gllm.platform === 'darwin' && <div>
        <p>{t(accessibilityGranted ? 'workspace.macAccessibilityGranted' : 'workspace.macAccessibilityNeeded')}</p>
        <button className="secondary-action" type="button" onClick={() => void window.gllm.checkComputerAccessibility(true).then(setAccessibilityGranted).catch(reason => setError(String(reason)))}>{t('workspace.macAccessibilityOpen')}</button>
      </div>}
      <label><input type="checkbox" checked={browserAccess} onChange={event => setBrowserAccess(event.target.checked)} />{t('workspace.browserAccess')}</label>
      <p>{t('workspace.browserAccessDescription')}</p>
      <p>{t('workspace.desktopApprovalHint')}</p>
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
      <label><input type="checkbox" checked={harnessEnabled} onChange={event => { setHarnessEnabled(event.target.checked); if (!event.target.checked) setHarnessDelegateAll(false) }} />{t('workspace.harnessEnable')}</label>
      <p>{t('workspace.harnessDescription')}</p>
      {status?.harness && <p role="status" className={status.harness.installed ? 'harness-ready' : 'harness-missing'}>{t(status.harness.installed ? 'workspace.harnessReady' : 'workspace.harnessMissing')}{status.harness.nodeVersion ? ` (Node ${status.harness.nodeVersion})` : ''}</p>}
      {harnessEnabled && <>
        <label><input type="checkbox" checked={harnessDelegateAll} onChange={event => setHarnessDelegateAll(event.target.checked)} />{t('workspace.harnessDelegateAll')}</label>
        <p>{t('workspace.harnessDelegateAllDescription')}</p>
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
      <footer>
        <label className="workspace-apply-scope">{t('workspace.applyScope')}
          <select value={applyScope} onChange={event => setApplyScope(event.target.value as WorkspaceApplyScope)} disabled={saving}>
            <option value="conversation">{t('workspace.applyScopeConversation')}</option>
            <option value="assistant">{t('workspace.applyScopeAssistant')}</option>
            <option value="children">{t('workspace.applyScopeChildren')}</option>
          </select>
        </label>
        <button className="secondary-action" disabled={saving} onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary-action" disabled={!valid || saving || loading} onClick={() => void save()}>{t('common.save')}</button>
      </footer>
    </section>
  </div>
}
