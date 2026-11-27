/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type {
  WorkspaceInteractionOption,
  WorkspaceInteractionRecord,
  WorkspaceInteractionRequest,
  WorkspaceInteractionResponse,
  WorkspaceInteractionSelection
} from '../shared/types.ts'

export const WORKSPACE_INTERACTION_LIMIT = 200
/** A pending question older than this cannot be answered any more. */
export const WORKSPACE_INTERACTION_TTL_MS = 24 * 60 * 60 * 1000
const OPTION_LIMIT = 6
const TITLE_LIMIT = 120
const DESCRIPTION_LIMIT = 400
const OPTION_LABEL_LIMIT = 80
const OPTION_DESCRIPTION_LIMIT = 160
const CUSTOM_TEXT_LIMIT = 2_000
const CONTEXT_LIMIT = 2_000

const selections = new Set<WorkspaceInteractionSelection>(['single', 'multiple', 'text', 'confirm'])

export interface WorkspaceInteractionInput {
  title?: unknown
  description?: unknown
  question?: unknown
  selection?: unknown
  options?: unknown
  allowCustom?: unknown
  allowSkip?: unknown
  context?: unknown
  kind?: unknown
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function slug(value: unknown, index: number): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const cleaned = raw.replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return cleaned || `option-${index + 1}`
}

function normalizeOptions(value: unknown): WorkspaceInteractionOption[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const options: WorkspaceInteractionOption[] = []
  for (const [index, item] of value.entries()) {
    if (options.length >= OPTION_LIMIT) break
    if (typeof item === 'string') {
      const label = text(item, OPTION_LABEL_LIMIT)
      if (!label) continue
      const id = slug(label, index)
      if (seen.has(id)) continue
      seen.add(id)
      options.push({ id, label })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const label = text(raw.label ?? raw.title ?? raw.text, OPTION_LABEL_LIMIT)
    if (!label) continue
    const id = slug(raw.id ?? label, index)
    if (seen.has(id)) continue
    seen.add(id)
    options.push({
      id,
      label,
      ...(text(raw.description, OPTION_DESCRIPTION_LIMIT) ? { description: text(raw.description, OPTION_DESCRIPTION_LIMIT) } : {}),
      ...(raw.recommended === true ? { recommended: true } : {})
    })
  }
  return options
}

/**
 * Turn a model-authored `ask_user` payload into a bounded, render-safe request.
 * Unknown shapes degrade to a free-text question instead of failing the run.
 */
export function normalizeInteractionRequest(
  input: WorkspaceInteractionInput,
  context: { id?: string; conversationId: string; taskId?: string; runId?: string; now?: number }
): WorkspaceInteractionRequest {
  const now = context.now ?? Date.now()
  const options = normalizeOptions(input.options)
  const requested = typeof input.selection === 'string' && selections.has(input.selection as WorkspaceInteractionSelection)
    ? input.selection as WorkspaceInteractionSelection
    : 'single'
  const selection: WorkspaceInteractionSelection = options.length === 0 && (requested === 'single' || requested === 'multiple')
    ? 'text'
    : requested
  const title = text(input.title, TITLE_LIMIT) || text(input.question, TITLE_LIMIT) || '需要你确认'
  const description = text(input.description, DESCRIPTION_LIMIT) || text(input.question, DESCRIPTION_LIMIT)
  return {
    id: context.id ?? randomUUID(),
    conversationId: context.conversationId,
    ...(context.taskId ? { taskId: context.taskId } : {}),
    ...(context.runId ? { runId: context.runId } : {}),
    kind: input.kind === 'auth' ? 'auth' : 'question',
    title,
    ...(description ? { description } : {}),
    selection,
    options,
    allowCustom: input.allowCustom === true || (input.allowCustom === undefined && selection !== 'confirm'),
    allowSkip: input.allowSkip !== false,
    ...(text(input.context, CONTEXT_LIMIT) ? { context: text(input.context, CONTEXT_LIMIT) } : {}),
    createdAt: now,
    expiresAt: now + WORKSPACE_INTERACTION_TTL_MS
  }
}

export function normalizeInteractionResponse(
  request: WorkspaceInteractionRequest,
  input: { selectedIds?: unknown; customText?: unknown; cancelled?: unknown; answeredAt?: number }
): WorkspaceInteractionResponse {
  const chosen = Array.isArray(input.selectedIds)
    ? input.selectedIds.filter((id): id is string => typeof id === 'string' && request.options.some((option) => option.id === id))
    : []
  const allowed = request.selection === 'multiple' ? chosen : chosen.slice(0, 1)
  const customText = text(input.customText, CUSTOM_TEXT_LIMIT)
  const cancelled = input.cancelled === true || (allowed.length === 0 && !customText && request.selection !== 'confirm')
  return {
    id: request.id,
    selectedIds: cancelled ? [] : allowed,
    ...(customText && !cancelled ? { customText } : {}),
    cancelled,
    answeredAt: input.answeredAt ?? Date.now()
  }
}

/** Render the answer as the tool result the model will read next turn. */
export function formatInteractionAnswer(
  request: WorkspaceInteractionRequest,
  response: WorkspaceInteractionResponse,
  language: 'zh' | 'en' = 'zh'
): string {
  const zh = language === 'zh'
  if (response.cancelled) {
    return zh
      ? '用户取消了这次提问，没有给出选择。不要重复提问同一个问题；如无其他可行路径，请说明当前阻塞并等待用户下一步指示。'
      : 'The user dismissed the question without answering. Do not repeat the same question; if no other path exists, report the blocker and wait for further instruction.'
  }
  const labels = response.selectedIds
    .map((id) => request.options.find((option) => option.id === id))
    .filter((option): option is WorkspaceInteractionOption => Boolean(option))
    .map((option) => `${option.label} (${option.id})`)
  if (request.selection === 'confirm' && labels.length === 0 && !response.customText) {
    return zh
      ? '用户已确认继续。请继续原任务，不要再次询问同一件事。'
      : 'The user confirmed to continue. Proceed with the original task and do not ask again.'
  }
  const parts: string[] = []
  if (labels.length > 0) parts.push(zh ? `选择：${labels.join('、')}` : `Selection: ${labels.join(', ')}`)
  if (response.customText) parts.push(zh ? `补充说明：${response.customText}` : `Additional input: ${response.customText}`)
  if (parts.length === 0) parts.push(zh ? '用户未提供具体内容' : 'The user did not provide details')
  return [
    zh ? '用户已回答你的提问，请据此继续原任务，不要再次询问同一问题。' : 'The user answered your question. Continue the original task and do not ask it again.',
    ...parts
  ].join('\n')
}

export function isInteractionExpired(record: WorkspaceInteractionRecord, now = Date.now()): boolean {
  if (record.status !== 'pending') return false
  const expiresAt = record.request.expiresAt ?? record.request.createdAt + WORKSPACE_INTERACTION_TTL_MS
  return now > expiresAt
}

interface StoredInteractions {
  version: 1
  records: WorkspaceInteractionRecord[]
}

/**
 * Persistent queue of pending agent questions. The store survives restarts so a
 * question asked before a crash can still be surfaced and answered afterwards.
 */
export class WorkspaceInteractionStore {
  private readonly path: string

  constructor(dataRoot: string, fileName = 'workspace-interactions.json') {
    this.path = join(dataRoot, fileName)
  }

  private read(): WorkspaceInteractionRecord[] {
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as StoredInteractions
      if (raw.version !== 1 || !Array.isArray(raw.records)) return []
      return raw.records.filter((record) => record && typeof record === 'object' && record.request && typeof record.request.id === 'string')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      return []
    }
  }

  private write(records: WorkspaceInteractionRecord[]): void {
    const payload: StoredInteractions = { version: 1, records: records.slice(-WORKSPACE_INTERACTION_LIMIT) }
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(payload), { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true })
      renameSync(temporary, this.path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }

  list(): WorkspaceInteractionRecord[] {
    return this.read()
  }

  /** Insert (or refresh) a pending request. Re-asking the same question reuses its id. */
  create(request: WorkspaceInteractionRequest): WorkspaceInteractionRecord {
    const records = this.read()
    const existing = records.findIndex((record) => record.request.id === request.id)
    const record: WorkspaceInteractionRecord = { request, status: 'pending' }
    if (existing >= 0) {
      // Never reopen a question that was already answered or cancelled: the
      // stored response is the authoritative record for that request id.
      if (records[existing].status !== 'pending') return records[existing]
      records[existing] = record
    } else records.push(record)
    this.write(this.settleExpired(records))
    return record
  }

  pending(conversationId?: string, now = Date.now()): WorkspaceInteractionRequest[] {
    const records = this.settleExpired(this.read(), now)
    return records
      .filter((record) => record.status === 'pending' && (!conversationId || record.request.conversationId === conversationId))
      .map((record) => record.request)
  }

  get(id: string): WorkspaceInteractionRecord | undefined {
    return this.read().find((record) => record.request.id === id)
  }

  /**
   * Resolve a pending request exactly once. Returns undefined when the request is
   * unknown, already answered, cancelled or expired, which makes repeated clicks safe.
   */
  resolve(id: string, response: WorkspaceInteractionResponse, now = Date.now()): WorkspaceInteractionRecord | undefined {
    const records = this.settleExpired(this.read(), now)
    const index = records.findIndex((record) => record.request.id === id)
    if (index < 0) return undefined
    const record = records[index]
    if (record.status !== 'pending') return undefined
    const settled: WorkspaceInteractionRecord = {
      ...record,
      status: response.cancelled ? 'cancelled' : 'answered',
      response,
      resolvedAt: now
    }
    records[index] = settled
    this.write(records)
    return settled
  }

  cancel(id: string, now = Date.now()): boolean {
    const records = this.settleExpired(this.read(), now)
    const index = records.findIndex((record) => record.request.id === id)
    if (index < 0 || records[index].status !== 'pending') return false
    records[index] = { ...records[index], status: 'cancelled', resolvedAt: now }
    this.write(records)
    return true
  }

  /** Mark stale pending questions as expired so the UI stops offering them. */
  settleExpired(records: WorkspaceInteractionRecord[], now = Date.now()): WorkspaceInteractionRecord[] {
    let changed = false
    const next = records.map((record) => {
      if (!isInteractionExpired(record, now)) return record
      changed = true
      return { ...record, status: 'expired' as const, resolvedAt: now }
    })
    if (changed) this.writeSafely(next)
    return next
  }

  private writeSafely(records: WorkspaceInteractionRecord[]): void {
    try {
      this.write(records)
    } catch {
      // A failed expiry rewrite must not break the answering flow.
    }
  }
}

/**
 * Persist the answer even when a live waiter consumed it.
 *
 * The IPC handler resolves the pending promise first and returns, which used to
 * leave the stored record at `pending`. The next time the UI loaded, the store
 * handed the same question back, so a question the user had already answered was
 * asked again — and again, because each answer repeated the mistake.
 */
export function persistInteractionAnswer(
  store: WorkspaceInteractionStore,
  id: string,
  response: WorkspaceInteractionResponse
): boolean {
  const record = store.get(id)
  if (!record || record.status !== 'pending') return false
  return Boolean(store.resolve(id, response))
}

/**
 * Render the answer as a transcript line (shared with the renderer, which writes
 * the same message when the user clicks so the record is never lost to a later
 * whole-conversation save).
 */
export { describeInteractionAnswer } from '../shared/interactionTranscript.ts'
