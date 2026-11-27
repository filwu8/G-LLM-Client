/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkspacePlan, finishPlan, pauseChoicesFor, pauseTitleFor, readBlockedQuestion, updatePlanStep } from './agentPlanning.ts'
import { applyPlanUpdate, MAX_PLAN_STEPS, parsePlanSteps, planCompletionNote, planProgressText, planVouchesCompletion, restorePlan } from './agentPlanning.ts'

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

// The checklist is not decoration: it is rendered as progress and replayed to
// the model after a compaction, so a list that lies about where the run is
// costs a user's trust once and the model's context twice.
test('a model checklist is accepted only in a shape that can be shown as progress', () => {
  const steps = parsePlanSteps([
    { title: '  读取  AGENTS.md  ', status: 'in_progress' },
    '列出受影响的测试文件',
    { title: '修改 workspaceAgent.ts', status: 'in_progress' },
    { title: '读取 AGENTS.md' },
    { title: '', status: 'completed' },
    { name: '跑 typecheck', status: 'done' }
  ])
  assert.deepEqual(steps?.map(({ title, status }) => [title, status]), [
    ['读取 AGENTS.md', 'running'],
    ['列出受影响的测试文件', 'pending'],
    // A second "in progress" is not progress: only the first step is current.
    ['修改 workspaceAgent.ts', 'pending'],
    ['跑 typecheck', 'completed']
  ])
  // Ids are positional and stable, so a resume can point at the same line.
  assert.deepEqual(steps?.map(({ id }) => id), ['step-1', 'step-2', 'step-3', 'step-4'])

  // Restating the goal is not a plan, and an empty list is not a plan either.
  assert.equal(parsePlanSteps(['打开文件']), undefined)
  assert.equal(parsePlanSteps([]), undefined)
  assert.equal(parsePlanSteps(undefined), undefined)
  assert.equal(parsePlanSteps({ steps: [] }), undefined)

  const many = parsePlanSteps(Array.from({ length: 20 }, (_, index) => `步骤 ${index + 1}`))
  assert.equal(many?.length, MAX_PLAN_STEPS)
  const long = parsePlanSteps([`${'很长'.repeat(200)}`, '第二步'])
  assert.ok((long?.[0].title.length ?? 0) <= 120)
})

test('a model plan replaces the derived lifecycle and keeps its goal', () => {
  const derived = createWorkspacePlan('把三个仓库同步到远端', 10)
  const steps = parsePlanSteps(['检查三个仓库的状态', '逐个 fetch 并快进', '确认没有落后分支'])
  assert.ok(steps)
  const applied = applyPlanUpdate(derived, steps)
  assert.equal(applied.goal, '把三个仓库同步到远端')
  assert.equal(applied.startedAt, 10)
  assert.equal(applied.status, 'executing')
  assert.deepEqual(applied.steps.map(({ title }) => title), ['检查三个仓库的状态', '逐个 fetch 并快进', '确认没有落后分支'])
  // The input array is not shared with the plan: a later mutation by the caller
  // must not silently rewrite what the UI already rendered.
  steps[0].status = 'completed'
  assert.equal(applied.steps[0].status, 'pending')
})

test('a plan read back from a checkpoint is validated, not trusted', () => {
  const saved = applyPlanUpdate(createWorkspacePlan('goal', 10), parsePlanSteps([
    { title: '检查仓库状态', status: 'completed' },
    { title: '同步远端', status: 'running' },
    { title: '确认结果', status: 'pending' }
  ])!)
  const restored = restorePlan(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(restored, saved)

  // A run that stopped with nothing in flight resumes at the first open step,
  // otherwise the checklist would show no current line at all.
  const paused = { ...saved, steps: saved.steps.map((step) => ({ ...step, status: 'completed' as const })).map((step, index) => index === 2 ? { ...step, status: 'pending' as const } : step) }
  assert.equal(restorePlan(paused)?.steps.find((step) => step.status === 'running')?.title, '确认结果')
  assert.equal(restorePlan(paused)?.status, 'executing')

  // Old checkpoints and truncated writes carry no usable plan: falling back to
  // a fresh lifecycle is the only safe answer.
  assert.equal(restorePlan({ goal: 'goal', startedAt: 10 }), undefined)
  assert.equal(restorePlan({ goal: 'goal', startedAt: 10, steps: 'nope' }), undefined)
  assert.equal(restorePlan({ steps: saved.steps }), undefined)
  assert.equal(restorePlan(null), undefined)
})

test('the checklist reports a position a user can read at a glance', () => {
  const plan = applyPlanUpdate(createWorkspacePlan('goal', 10), parsePlanSteps([
    { title: '检查仓库状态', status: 'completed' },
    { title: '同步远端', status: 'running' },
    { title: '确认结果' }
  ])!)
  assert.equal(planProgressText(plan), '1/3 · 同步远端')
  const finished = finishPlan(plan, 'succeeded', 'done', 20)
  assert.equal(planProgressText(finished), '3/3')
  // A deliberate skip stays skipped; success must not claim it happened.
  const skipped = finishPlan({ ...plan, steps: plan.steps.map((step) => ({ ...step, status: 'skipped' as const })) }, 'succeeded', 'done', 20)
  assert.ok(skipped.steps.every((step) => step.status === 'skipped'))
})

test('only a finished checklist the model wrote can stand in for a verdict', () => {
  // The generic lifecycle says the same five things about every job, so even a
  // fully ticked one proves nothing about this task.
  const derived = finishPlan(createWorkspacePlan('goal', 10), 'succeeded', 'done', 20)
  assert.equal(planVouchesCompletion(derived), false)

  const done = applyPlanUpdate(createWorkspacePlan('goal', 10), parsePlanSteps([
    { title: '同步三个仓库到 origin/main', status: 'completed' },
    { title: '确认工作区只剩预期改动', status: 'completed' }
  ])!)
  assert.equal(planVouchesCompletion(done), true)
  assert.match(planCompletionNote(done), /2\/2/)
  assert.match(planCompletionNote(done, 'en'), /2 checklist steps/)

  // Part of the work not done, or deliberately skipped, is not finished work.
  const open = { ...done, steps: done.steps.map((step, index) => index === 1 ? { ...step, status: 'pending' as const } : step) }
  assert.equal(planVouchesCompletion(open), false)
  const skipped = { ...done, steps: done.steps.map((step, index) => index === 1 ? { ...step, status: 'skipped' as const } : step) }
  assert.equal(planVouchesCompletion(skipped), false)
  const failed = { ...done, steps: done.steps.map((step, index) => index === 1 ? { ...step, status: 'failed' as const } : step) }
  assert.equal(planVouchesCompletion(failed), false)
})

test('a checkpoint remembers whether its steps were model-written', () => {
  const checklist = applyPlanUpdate(createWorkspacePlan('goal', 10), parsePlanSteps(['读 a.txt', '读 b.txt'])!)
  assert.equal(restorePlan(JSON.parse(JSON.stringify(checklist)))?.source, 'checklist')
  assert.equal(restorePlan(JSON.parse(JSON.stringify(createWorkspacePlan('goal', 10))))?.source, 'derived')
  // Checkpoints written before the flag existed carry a model list without it.
  // Reading those as derived is the conservative choice: they still resume with
  // their steps, they just cannot close the run on their own.
  const legacy = JSON.parse(JSON.stringify({ ...checklist, source: undefined }))
  assert.equal(restorePlan(legacy)?.source, 'derived')
  assert.equal(planVouchesCompletion(restorePlan(legacy)!), false)
})
