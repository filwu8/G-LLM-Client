/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import { createHash } from 'node:crypto'
import { DEFAULT_PROVIDER, isOfficialGllmApiProvider } from '../shared/providers.ts'
import type { ApiProvider, DeepLinkHandoffStatusEvent, ProviderModel } from '../shared/types'
import { GLLM_CONNECT_URL } from './gllmAccount.ts'

interface ConnectionDependencies {
  openBrowser(url: string): Promise<void>
  exchange(code: string, signal: AbortSignal): Promise<{ apiKey: string }>
  getProvider(): ApiProvider | undefined
  saveProvider(provider: ApiProvider): ApiProvider
  fetchModels(provider: ApiProvider, signal: AbortSignal): Promise<ProviderModel[]>
  activate(): void
  notify(state: DeepLinkHandoffStatusEvent): void
}

export class GllmConnection {
  private state: DeepLinkHandoffStatusEvent = { status: 'idle' }
  private epoch = 0
  private controller?: AbortController
  private expiry?: ReturnType<typeof setTimeout>
  private accepting = true // A cold-start protocol callback must work without an open renderer.
  private readonly completed = new Set<string>()
  private readonly pending = new Set<string>()
  private readonly deps: ConnectionDependencies
  private readonly waitMs: number
  constructor(deps: ConnectionDependencies, waitMs = 180_000) { this.deps = deps; this.waitMs = waitMs }
  getState(): DeepLinkHandoffStatusEvent { return { ...this.state } }
  private publish(state: DeepLinkHandoffStatusEvent): void { this.state = state; this.deps.notify(this.getState()) }
  private stop(): number {
    this.controller?.abort()
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = undefined
    return ++this.epoch
  }
  cancel(): DeepLinkHandoffStatusEvent {
    this.stop(); this.accepting = false
    this.publish({ status: 'cancelled' })
    return this.getState()
  }
  async begin(): Promise<DeepLinkHandoffStatusEvent> {
    const epoch = this.stop()
    this.accepting = true
    this.publish({ status: 'waiting' })
    this.expiry = setTimeout(() => {
      if (epoch !== this.epoch) return
      this.stop(); this.accepting = false; this.publish({ status: 'expired' })
    }, this.waitMs)
    this.expiry.unref?.()
    try { await this.deps.openBrowser(GLLM_CONNECT_URL) }
    catch { if (epoch === this.epoch) { this.stop(); this.accepting = false; this.publish({ status: 'error', reason: 'browser' }) } }
    return this.getState()
  }
  async retry(): Promise<DeepLinkHandoffStatusEvent> {
    if (this.state.status !== 'error' || this.state.reason !== 'models') return this.begin()
    const provider = this.deps.getProvider()
    if (!provider?.apiKey || !isOfficialGllmApiProvider(provider)) return this.begin()
    const epoch = this.stop(), controller = this.controller = new AbortController()
    await this.loadModels(provider, epoch, controller.signal)
    return this.getState()
  }
  private async loadModels(provider: ApiProvider, epoch: number, signal: AbortSignal): Promise<void> {
    this.publish({ status: 'models' })
    try {
      const models = await this.deps.fetchModels(provider, signal)
      if (epoch !== this.epoch || signal.aborted) return
      const current = this.deps.getProvider()
      if (!current || current.apiKey !== provider.apiKey || !isOfficialGllmApiProvider(current)) throw new Error('credential changed')
      // Choose an available conversational model, not a stale preset or image-only model.
      const chat = models.filter(model => model.capabilities?.includes('chat') || model.type === 'chat' || model.type === 'vision' || (!model.type && !model.capabilities?.length))
      if (!chat.length) throw new Error('no conversational models')
      const defaultModel = chat.some(model => model.id === provider.defaultModel) ? provider.defaultModel : chat[0].id
      this.deps.saveProvider({ ...provider, models, defaultModel, modelsUpdatedAt: Date.now() })
      this.deps.activate()
      this.publish({ status: 'success' })
    } catch { if (epoch === this.epoch && !signal.aborted) this.publish({ status: 'error', reason: 'models' }) }
  }
  async receive(code: string): Promise<void> {
    if (!this.accepting) return
    const digest = createHash('sha256').update(code).digest('hex')
    if (this.pending.has(digest) || this.completed.has(digest)) return
    this.pending.add(digest)
    const epoch = this.stop(), controller = this.controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    let reason: 'exchange' | 'storage' = 'exchange'
    try {
      this.publish({ status: 'exchanging' })
      const { apiKey } = await this.deps.exchange(code, controller.signal)
      if (epoch !== this.epoch || controller.signal.aborted) return
      reason = 'storage'
      const saved = this.deps.saveProvider({ ...DEFAULT_PROVIDER, apiKey, models: [], modelsUpdatedAt: undefined, credentialUnavailable: false })
      if (saved.apiKey !== apiKey || saved.credentialUnavailable) throw new Error('secure save failed')
      this.completed.add(digest)
      if (this.completed.size > 128) this.completed.delete(this.completed.values().next().value!)
      await this.loadModels(saved, epoch, controller.signal)
    } catch {
      if (epoch === this.epoch) this.publish({ status: 'error', reason })
    } finally {
      clearTimeout(timer)
      this.pending.delete(digest)
      if (epoch === this.epoch && controller.signal.aborted && ['exchanging', 'models'].includes(this.state.status)) {
        this.publish({ status: 'error', reason: this.state.status === 'models' ? 'models' : 'exchange' })
      }
    }
  }
}
