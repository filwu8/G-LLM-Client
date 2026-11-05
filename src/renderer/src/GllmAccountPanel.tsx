/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import { LogIn, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_PROVIDER_ID, isOfficialGllmApiProvider } from '@shared/providers'
import type { ApiProvider, DeepLinkHandoffStatusEvent, GllmAccountState } from '@shared/types'

export function isManagedGllmProvider(provider: ApiProvider): boolean {
  return provider.id === DEFAULT_PROVIDER_ID && isOfficialGllmApiProvider(provider)
}

export function GllmAccountPanel({ provider, onManualConfiguration, compact = false }: {
  provider: ApiProvider; onManualConfiguration?: () => void; compact?: boolean
}) {
  const { t, i18n } = useTranslation()
  const [connection, setConnection] = useState<DeepLinkHandoffStatusEvent>({ status: 'idle' })
  const [account, setAccount] = useState<GllmAccountState>({ status: 'disconnected' })
  const [loading, setLoading] = useState(false)
  const [refreshId, setRefreshId] = useState(0)
  const managed = isManagedGllmProvider(provider)
  const connected = Boolean(provider.apiKey) && !provider.credentialUnavailable
  const busy = ['waiting', 'exchanging', 'models'].includes(connection.status)
  useEffect(() => {
    if (!managed) return
    let active = true, changed = false
    const unsubscribe = window.gllm.onDeepLinkHandoffStatus(state => { changed = true; setConnection(state) })
    void window.gllm.getGllmConnectionState().then(state => { if (active && !changed) setConnection(state) }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [managed])
  useEffect(() => {
    let active = true
    if (!managed || !connected) { setAccount({ status: provider.credentialUnavailable ? 'credential-unavailable' : 'disconnected' }); setLoading(false); return }
    setLoading(true)
    void window.gllm.getGllmAccount().then(state => { if (active) setAccount(state) })
      .catch(() => { if (active) setAccount({ status: 'unavailable' }) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [managed, connected, provider.apiKey, provider.credentialUnavailable, refreshId])
  if (!managed) return null
  const connect = (retry = false) => {
    const request = retry ? window.gllm.retryGllmConnection() : window.gllm.connectGllm()
    void request.catch(() => setConnection({ status: 'error', reason: 'browser' }))
  }
  const balance = account.status === 'ready'
    ? new Intl.NumberFormat(i18n.language, { maximumSignificantDigits: 12 }).format(Math.max(0, account.remainingQuota / account.quotaPerUnit)) : ''
  return <section className={`gllm-account-panel ${compact || connected ? 'compact' : ''}`} aria-label={t('account.title')}>
    <div className="gllm-account-heading"><LogIn size={18} /><strong>{t(connected ? 'account.connected' : 'account.title')}</strong></div>
    {!connected && <p>{t('account.introduction')}</p>}
    {provider.credentialUnavailable && <p role="alert">{t('account.credentialUnavailable')}</p>}
    {busy && <p role="status" className="gllm-account-progress"><LoaderCircle className="spin" size={15} />{t(`account.phase.${connection.status}`)}</p>}
    {connection.status === 'error' && <p role="alert">{t(`account.error.${connection.reason ?? 'exchange'}`)}</p>}
    {connection.status === 'expired' && <p role="status">{t('account.expired')}</p>}
    {connection.status === 'cancelled' && <p role="status">{t('account.cancelled')}</p>}
    {connected && <div className="gllm-account-balance" aria-live="polite">
      {loading ? <span>{t('account.loading')}</span> : account.status === 'ready'
        ? <><strong>{t('account.balance', { amount: balance })}</strong><small>{t('account.billingNote')}</small>
          {account.remainingQuota <= 0 && <p role="status">{t('account.exhausted')}</p>}</>
        : <span>{t(account.status === 'unauthorized' ? 'account.unauthorized' : 'account.unavailable')}</span>}
    </div>}
    <div className="gllm-account-actions">
      {busy ? <button className="secondary-action" type="button" onClick={() => void window.gllm.cancelGllmConnection().catch(() => {})}>{t('common.cancel')}</button>
        : (!connected || account.status === 'unauthorized' || connection.status === 'error') && <button className="primary-action" type="button" onClick={() => connect(connection.status === 'error')}>{t(connection.status === 'error' || connection.status === 'expired' ? 'account.retry' : connected ? 'account.reconnect' : 'account.signIn')}</button>}
      {connection.status === 'waiting' && <button className="secondary-action" type="button" onClick={() => connect()}>{t('account.reopen')}</button>}
      {connected && <button type="button" className="secondary-action" disabled={loading} onClick={() => setRefreshId(id => id + 1)}><RefreshCw size={13} />{t('account.refresh')}</button>}
      {!connected && onManualConfiguration && <button className="secondary-action" type="button" onClick={onManualConfiguration}>{t('account.manual')}</button>}
    </div>
    {!connected && <small>{t('account.allowanceNote')}</small>}
  </section>
}
