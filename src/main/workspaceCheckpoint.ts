/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentPlanStep, WorkspaceInteractionRequest, WorkspaceToolActivity } from '../shared/types.ts'
import { withStoreWriteRetry } from './storageWriteRetry.ts'

export const WORKSPACE_EVIDENCE_HISTORY = 128

export interface WorkspaceCheckpointSummary {
  criteria: string
  verified: string
  remaining: string
  next: string
}

export interface WorkspaceCheckpoint {
  version: 1
  taskId: string
  root: string
  turns: number
  summary?: WorkspaceCheckpointSummary
  activities: WorkspaceToolActivity[]
  changedFiles: string[]
  evidence: string[]
  stalledTurns: number
  hasExecutionEvidence: boolean
  pendingTool?: string
  /** Model-owned todo steps, so a resumed run keeps its checklist. */
  todoSteps?: AgentPlanStep[]
  /**
   * A question the agent asked and is still waiting on. Unlike pendingTool this
   * is a safe resume point: the run can continue once an answer exists, and the
   * same request id is reused so the user is never asked twice.
   */
  pendingInteraction?: WorkspaceInteractionRequest
  /** Side-effecting tool call ids already executed in this task, across resumes. */
  completedCallIds?: string[]
  /**
   * Operations the user explicitly rejected in this task. They stay blocked
   * across resumes and are never auto-approved by a permission-mode change.
   */
  deniedApprovals?: string[]
}

export function workspaceTaskId(messageId: string, goalId?: string): string {
  return goalId ? `goal:${goalId}` : `message:${messageId}`
}

export class WorkspaceCheckpointStore {
  private readonly path: string

  constructor(dataRoot: string, conversationId: string) {
    const key = createHash('sha256').update(conversationId).digest('hex')
    this.path = join(dataRoot, 'workspace-checkpoints', `${key}.json`)
  }

  private read(): WorkspaceCheckpoint | undefined {
    try {
      const checkpoint = JSON.parse(readFileSync(this.path, 'utf8')) as WorkspaceCheckpoint
      if (checkpoint.version !== 1 || typeof checkpoint.taskId !== 'string' || typeof checkpoint.root !== 'string' ||
        !Number.isSafeInteger(checkpoint.turns) || checkpoint.turns < 0 || !Array.isArray(checkpoint.activities) ||
        !Array.isArray(checkpoint.changedFiles) || !Array.isArray(checkpoint.evidence)) {
        throw new Error('Invalid workspace checkpoint')
      }
      return checkpoint
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  load(taskId: string, root: string, resolveStoredRoot = (path: string) => path): WorkspaceCheckpoint | undefined {
    const checkpoint = this.read()
    return checkpoint?.taskId === taskId && resolveStoredRoot(checkpoint.root) === root ? checkpoint : undefined
  }

  /**
   * The model's checklist outlives a task boundary: every user message starts a
   * new taskId, so `load` never matches and the todo list was rebuilt from
   * scratch each turn. Read the steps alone, without the single-turn state
   * (pendingTool, call ids, denials) that must not cross tasks.
   */
  loadTodoSteps(root: string, resolveStoredRoot = (path: string) => path): AgentPlanStep[] {
    const checkpoint = this.read()
    if (!checkpoint || resolveStoredRoot(checkpoint.root) !== root) return []
    return Array.isArray(checkpoint.todoSteps) ? checkpoint.todoSteps : []
  }

  save(checkpoint: WorkspaceCheckpoint): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    try {
      // Windows can briefly lock the target during the atomic rename (AV/indexers).
      // Retry transient locks so a checkpoint write cannot abort an agent run.
      // Clear a prior attempt's temp file first: writeFileSync uses flag 'wx',
      // which would otherwise fail with EEXIST on the second attempt.
      withStoreWriteRetry(() => {
        rmSync(temporaryPath, { force: true })
        writeFileSync(temporaryPath, JSON.stringify(checkpoint), { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true })
        renameSync(temporaryPath, this.path)
      })
    } finally {
      rmSync(temporaryPath, { force: true })
    }
  }

  remove(taskId?: string): void {
    if (taskId && this.read()?.taskId !== taskId) return
    rmSync(this.path, { force: true })
  }
}
