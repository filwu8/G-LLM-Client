/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { GoalTask, GoalTaskStatus, WorkspaceAgentRequest } from './types'

export const GOAL_EXECUTION_TIME_LIMIT = 'GOAL_EXECUTION_TIME_LIMIT'
export const WORKSPACE_TURN_CHECKPOINT = 14
export const WORKSPACE_ACTIVITY_HISTORY = 80
export const WORKSPACE_ALREADY_RUNNING = 'WORKSPACE_ALREADY_RUNNING'

export function normalizeGoalExecutionLimits(limits?: WorkspaceAgentRequest['executionLimits']): {
  maxTurns: number
  maxDurationMs: number
} {
  return {
    maxTurns: limits ? Math.max(3, Math.min(14, Math.round(limits.maxTurns ?? 14))) : Number.POSITIVE_INFINITY,
    maxDurationMs: limits
      ? Math.max(60_000, Math.min(4 * 60 * 60 * 1000, Math.round(limits.maxDurationMs)))
      : Number.POSITIVE_INFINITY
  }
}

export function isGoalExecutionTimeLimitMessage(message: string): boolean {
  return message.includes(GOAL_EXECUTION_TIME_LIMIT)
}

export function getEffectiveGoalTaskStatus(task: GoalTask, running: boolean): GoalTaskStatus {
  return task.status === 'running' && !running ? 'paused' : task.status
}
