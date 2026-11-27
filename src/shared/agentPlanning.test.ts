/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkspacePlan, finishPlan, pauseChoicesFor, pauseTitleFor, readBlockedQuestion, updatePlanStep } from './agentPlanning.ts'

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

// The card a user could not answer offered "I will add the missing information"
// for a run that had not lost any information: the model had answered and the
// client could not verify it. The choices now follow the reason, so the middle
// case asks the only two things it can — accept, or say what is still missing.
test('the choices offered match why the run stopped', () => {
  const ids = (reason: Parameters<typeof pauseChoicesFor>[0], language: 'zh' | 'en' = 'zh') =>
    pauseChoicesFor(reason, language).map((choice) => choice.id)

  // Accepting must be reachable, and asking for data that does not exist is not.
  assert.deepEqual(ids('unconfirmed'), ['accept', 'continue', 'pause'])
  // An outage or a stall is fixed by retrying, never by typing more.
  assert.deepEqual(ids('engine'), ['retry', 'pause'])
  assert.deepEqual(ids('provider'), ['retry', 'pause'])
  // Only a genuine gap in the user's knowledge asks them to supply it.
  assert.deepEqual(ids('missing-info'), ['provide', 'retry', 'pause'])

  // Both languages expose the same ids: the run branches on them, so a missing
  // translation would silently disable a path for one language.
  for (const reason of ['unconfirmed', 'engine', 'provider', 'missing-info'] as const) {
    assert.deepEqual(ids(reason, 'en'), ids(reason, 'zh'), reason)
    for (const choice of pauseChoicesFor(reason, 'en')) {
      assert.ok(choice.label.trim() && choice.description.trim(), `${reason}/${choice.id} needs text`)
    }
  }
})

// The title used to be the fixed "The task needs one more thing from you" even
// when nothing was needed from the user, which is what made the card opaque.
test('the title names the situation instead of asking for information by default', () => {
  assert.equal(pauseTitleFor('unconfirmed'), '这一轮没通过自动核对')
  assert.equal(pauseTitleFor('engine'), '这一步没有取得进展')
  assert.equal(pauseTitleFor('provider'), '模型服务这次没有响应')
  assert.equal(pauseTitleFor('missing-info'), '需要你补充一点信息')
  assert.notEqual(pauseTitleFor('provider', 'en'), pauseTitleFor('unconfirmed', 'en'))
  // The three cases where the user owes nothing must not read like a request for
  // data; only the fourth one legitimately asks for it.
  for (const reason of ['unconfirmed', 'engine', 'provider'] as const) {
    assert.doesNotMatch(pauseTitleFor(reason, 'en'), /补充|add the missing/i, `${reason} must not imply the user owes data`)
    assert.doesNotMatch(pauseTitleFor(reason, 'zh'), /补充/, `${reason} must not imply the user owes data`)
  }
  assert.match(pauseTitleFor('missing-info', 'en'), /one more thing/i)
})
