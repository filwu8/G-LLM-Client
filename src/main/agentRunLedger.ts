/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

import { redactMainLogText } from './logRedaction.ts'
import type {
  AgentRunEvent,
  AgentRunEventType,
  AgentRunKind,
  AgentRunRecord,
  AgentRunSnapshot,
  AgentRunStatus
} from '../shared/types.ts'

const snapshotFileName = 'agent-runs.json'
const eventFileName = 'agent-runs.jsonl'
const rotatedEventFileName = 'agent-runs.previous.jsonl'
const maxPersistedRuns = 100
const maxEventFileBytes = 5 * 1024 * 1024
const terminalStatuses = new Set<AgentRunStatus>(['stopped', 'succeeded', 'failed', 'interrupted'])
const recoverableStatuses = new Set<AgentRunStatus>([
  'queued',
  'planning',
  'running_model',
  'running_tool',
  'waiting_approval',
  'verifying',
  'retrying'
])

type DiagnosticValue = string | number | boolean | null

export interface StartAgentRunInput {
  kind: AgentRunKind
  conversationId: string
  requestKey?: string
  providerId: string
  modelId: string
  details?: Record<string, DiagnosticValue>
}

function sanitizeDiagnosticValue(value: DiagnosticValue): DiagnosticValue {
  if (typeof value !== 'string') return value
  return redactMainLogText(value).slice(0, 500)
}

function sanitizeDetails(details?: Record<string, DiagnosticValue>): Record<string, DiagnosticValue> | undefined {
  if (!details) return undefined
  const entries = Object.entries(details)
    .slice(0, 24)
    .map(([key, value]) => [key.slice(0, 80), sanitizeDiagnosticValue(value)] as const)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function isAgentRunRecord(value: unknown): value is AgentRunRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<AgentRunRecord>
  return typeof candidate.id === 'string' &&
    typeof candidate.conversationId === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.startedAt === 'number' &&
    typeof candidate.updatedAt === 'number'
}

export class AgentRunLedger {
  private readonly runs = new Map<string, AgentRunRecord>()
  private readonly snapshotPath: string
  private readonly eventPath: string
  private readonly rotatedEventPath: string
  private readonly now: () => number

  constructor(directory: string, now: () => number = Date.now) {
    this.now = now
    this.snapshotPath = join(directory, snapshotFileName)
    this.eventPath = join(directory, eventFileName)
    this.rotatedEventPath = join(directory, rotatedEventFileName)
    try {
      mkdirSync(directory, { recursive: true })
    } catch {
      // Keep an in-memory ledger if the diagnostics directory is unavailable.
    }
    this.loadSnapshot()
  }

  start(input: StartAgentRunInput): AgentRunRecord {
    const at = this.now()
    const run: AgentRunRecord = {
      id: randomUUID(),
      kind: input.kind,
      conversationId: input.conversationId,
      requestKey: input.requestKey ?? 'main',
      providerId: redactMainLogText(input.providerId).slice(0, 160),
      modelId: redactMainLogText(input.modelId).slice(0, 240),
      status: 'queued',
      startedAt: at,
      updatedAt: at,
      lastEventType: 'run_started',
      eventCount: 0
    }
    this.runs.set(run.id, run)
    this.record(run.id, 'run_started', 'queued', input.details)
    return { ...this.requireRun(run.id) }
  }

  record(
    runId: string,
    type: AgentRunEventType,
    status: AgentRunStatus,
    details?: Record<string, DiagnosticValue>
  ): AgentRunRecord {
    const current = this.requireRun(runId)
    if (terminalStatuses.has(current.status) && current.status !== status) return { ...current }

    const at = this.now()
    const event: AgentRunEvent = {
      id: randomUUID(),
      runId,
      conversationId: current.conversationId,
      sequence: current.eventCount + 1,
      type,
      status,
      at,
      details: sanitizeDetails(details)
    }
    const next: AgentRunRecord = {
      ...current,
      status,
      updatedAt: at,
      lastEventType: type,
      eventCount: event.sequence,
      ...(terminalStatuses.has(status) ? { finishedAt: at } : {})
    }
    if (typeof event.details?.inputTokens === 'number') next.inputTokens = event.details.inputTokens
    if (typeof event.details?.outputTokens === 'number') next.outputTokens = event.details.outputTokens
    if (typeof event.details?.totalTokens === 'number') next.totalTokens = event.details.totalTokens
    if (typeof event.details?.changedFiles === 'number') next.changedFiles = event.details.changedFiles
    if (typeof event.details?.errorCategory === 'string') next.errorCategory = event.details.errorCategory

    this.runs.set(runId, next)
    this.appendEvent(event)
    this.persistSnapshot()
    return { ...next }
  }

  recoverInterruptedRuns(): AgentRunRecord[] {
    const recovered: AgentRunRecord[] = []
    for (const run of this.runs.values()) {
      if (!recoverableStatuses.has(run.status)) continue
      recovered.push(this.record(run.id, 'run_interrupted', 'interrupted', { reason: 'application_restarted' }))
    }
    return recovered
  }

  get(runId: string): AgentRunRecord | undefined {
    const run = this.runs.get(runId)
    return run ? { ...run } : undefined
  }

  list(limit = 50): AgentRunRecord[] {
    const boundedLimit = Math.max(1, Math.min(maxPersistedRuns, Math.floor(limit)))
    return Array.from(this.runs.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, boundedLimit)
      .map((run) => ({ ...run }))
  }

  snapshot(limit = maxPersistedRuns): AgentRunSnapshot {
    return {
      version: 1,
      updatedAt: this.now(),
      runs: this.list(limit)
    }
  }

  private requireRun(runId: string): AgentRunRecord {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Unknown agent run: ${runId}`)
    return run
  }

  private loadSnapshot(): void {
    if (!existsSync(this.snapshotPath)) return
    try {
      const payload = JSON.parse(readFileSync(this.snapshotPath, 'utf8')) as Partial<AgentRunSnapshot>
      for (const run of Array.isArray(payload.runs) ? payload.runs : []) {
        if (isAgentRunRecord(run)) this.runs.set(run.id, run)
      }
    } catch {
      // A damaged diagnostics snapshot must never prevent the app from starting.
    }
  }

  private appendEvent(event: AgentRunEvent): void {
    try {
      this.rotateEventsIfNeeded()
      appendFileSync(this.eventPath, `${JSON.stringify(event)}\n`, 'utf8')
    } catch {
      // Diagnostics are best effort and must not fail the user task.
    }
  }

  private rotateEventsIfNeeded(): void {
    try {
      if (!existsSync(this.eventPath) || statSync(this.eventPath).size < maxEventFileBytes) return
      rmSync(this.rotatedEventPath, { force: true })
      renameSync(this.eventPath, this.rotatedEventPath)
    } catch {
      // Rotation is best effort; the current event can still be appended.
    }
  }

  private persistSnapshot(): void {
    const retained = this.list(maxPersistedRuns)
    const retainedIds = new Set(retained.map((run) => run.id))
    for (const id of this.runs.keys()) {
      if (!retainedIds.has(id)) this.runs.delete(id)
    }
    const temporaryPath = `${this.snapshotPath}.${process.pid}.tmp`
    try {
      writeFileSync(temporaryPath, JSON.stringify({ version: 1, updatedAt: this.now(), runs: retained }, null, 2), 'utf8')
      try {
        renameSync(temporaryPath, this.snapshotPath)
      } catch {
        // Windows does not consistently replace an existing file with rename.
        rmSync(this.snapshotPath, { force: true })
        renameSync(temporaryPath, this.snapshotPath)
      }
    } catch {
      rmSync(temporaryPath, { force: true })
      // Preserve the in-memory record even if persistence is temporarily unavailable.
    }
  }
}
