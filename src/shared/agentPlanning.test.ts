/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkspacePlan, finishPlan, updatePlanStep } from './agentPlanning.ts'

test('workspace plans expose the full understand-execute-verify-deliver lifecycle', () => {
  const plan = createWorkspacePlan('  ship a result  ', 10)
  assert.equal(plan.goal, 'ship a result')
  assert.deepEqual(plan.steps.map(({ id }) => id), ['understand', 'inspect', 'execute', 'verify', 'deliver'])
  assert.equal(plan.steps[0].status, 'running')
})

test('plan transitions preserve evidence and finish every step on success', () => {
  const verifying = updatePlanStep(createWorkspacePlan('goal', 10), 'verify', 'running', 'checking files')
  assert.equal(verifying.status, 'verifying')
  const finished = finishPlan(verifying, 'succeeded', 'all checks passed', 20)
  assert.equal(finished.status, 'succeeded')
  assert.equal(finished.completedAt, 20)
  assert.ok(finished.steps.every((step) => step.status === 'completed'))
  assert.equal(finished.verification, 'all checks passed')
})
