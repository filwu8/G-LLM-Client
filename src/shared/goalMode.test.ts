/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getEffectiveGoalTaskStatus,
  isGoalExecutionTimeLimitMessage,
  normalizeGoalExecutionLimits
} from './goalMode.ts'
import type { GoalTask } from './types.ts'

const task: GoalTask = {
  id: 'goal-1',
  goal: 'Ship the project',
  acceptanceCriteria: 'All checks pass',
  status: 'running',
  maxSteps: 8,
  maxDurationMinutes: 60,
  runCount: 1,
  startedAt: 10,
  lastRunStartedAt: 10,
  updatedAt: 10
}

test('treats a persisted running goal as resumable after restart', () => {
  assert.equal(getEffectiveGoalTaskStatus(task, false), 'paused')
  assert.equal(getEffectiveGoalTaskStatus(task, true), 'running')
})

test('clamps goal execution limits without limiting ordinary workspace runs by time', () => {
  assert.deepEqual(normalizeGoalExecutionLimits({ maxTurns: 99, maxDurationMs: 1 }), {
    maxTurns: 14,
    maxDurationMs: 60_000
  })
  assert.equal(normalizeGoalExecutionLimits().maxDurationMs, Number.POSITIVE_INFINITY)
})

test('recognizes the stable execution time limit marker', () => {
  assert.equal(isGoalExecutionTimeLimitMessage('GOAL_EXECUTION_TIME_LIMIT: paused'), true)
  assert.equal(isGoalExecutionTimeLimitMessage('network timeout'), false)
})
