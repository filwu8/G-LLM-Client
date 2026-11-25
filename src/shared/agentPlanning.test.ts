/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkspacePlan, finishPlan, readBlockedQuestion, updatePlanStep } from './agentPlanning.ts'

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

test('a waiting plan pauses the running step instead of marking the task failed', () => {
  const executing = updatePlanStep(createWorkspacePlan('goal', 10), 'execute', 'running')
  const paused = finishPlan(executing, 'waiting', '缺少申请人名称', 30)
  assert.equal(paused.status, 'waiting')
  // The user's answer unblocks this exact step, so it must stay resumable.
  assert.equal(paused.steps.find((step) => step.id === 'execute')?.status, 'running')
  assert.ok(paused.steps.every((step) => step.status !== 'failed'))
  assert.equal(finishPlan(executing, 'failed', 'boom', 40).status, 'failed')
})

test('a blocked verdict is turned into a concrete question for the user', () => {
  assert.deepEqual(
    readBlockedQuestion({ question: { title: '申请人', question: '申请人的全名是什么？', selection: 'text' } }, 'fallback'),
    { question: '申请人的全名是什么？', title: '申请人', selection: 'text' }
  )
  assert.deepEqual(readBlockedQuestion({ question: '合同的签署日期是哪一天？' }, 'fallback'), { question: '合同的签署日期是哪一天？' })
  // A model that explains the gap in `verification` only must still produce a
  // question: the run cannot demand schema compliance before helping the user.
  assert.deepEqual(readBlockedQuestion({ verification: '缺少申请人名称。', final: '请提供申请人名称。' }, 'fallback'), { question: '缺少申请人名称。' })
  assert.deepEqual(readBlockedQuestion(null, '工作目录在哪里？'), { question: '工作目录在哪里？' })
  assert.equal(readBlockedQuestion(null, '   '), undefined)
})
