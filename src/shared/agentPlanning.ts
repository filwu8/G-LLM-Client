/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { AgentExecutionPlan, AgentPlanStepStatus } from './types'

export function createWorkspacePlan(goal: string, now = Date.now()): AgentExecutionPlan {
  return {
    goal: goal.trim().slice(0, 500) || '完成当前工作区任务',
    status: 'planning',
    startedAt: now,
    steps: [
      { id: 'understand', title: '理解目标与约束', status: 'running' },
      { id: 'inspect', title: '检查工作区与相关资料', status: 'pending' },
      { id: 'execute', title: '调用工具并完成任务', status: 'pending' },
      { id: 'verify', title: '验证结果与产物', status: 'pending' },
      { id: 'deliver', title: '整理并交付结果', status: 'pending' }
    ]
  }
}

export function updatePlanStep(
  plan: AgentExecutionPlan,
  stepId: string,
  status: AgentPlanStepStatus,
  detail?: string
): AgentExecutionPlan {
  return {
    ...plan,
    status: stepId === 'verify' && status === 'running' ? 'verifying' : status === 'failed' ? 'failed' : 'executing',
    steps: plan.steps.map((step) => step.id === stepId ? { ...step, status, detail: detail?.slice(0, 500) } : step)
  }
}

export function finishPlan(
  plan: AgentExecutionPlan,
  outcome: 'succeeded' | 'failed' | 'waiting',
  verification: string,
  now = Date.now()
): AgentExecutionPlan {
  return {
    ...plan,
    status: outcome,
    verification: verification.trim().slice(0, 1000),
    completedAt: now,
    steps: plan.steps.map((step) => {
      if (outcome === 'succeeded') return { ...step, status: 'completed' as const }
      // A waiting plan is not a dead end: the step that was running is what
      // the user's answer unblocks, so it must not be painted as failed.
      if (outcome === 'waiting') return step
      if (step.status === 'running') return { ...step, status: 'failed' as const }
      return step
    })
  }
}

/** A question the run cannot answer itself and must hand to the user. */
export interface AgentBlockedQuestion {
  title?: string
  question: string
  /**
   * Stable name of the underlying blocker. The client asks about a given
   * blocker at most once per run, so a model that keeps restating the same
   * problem cannot turn it into a series of questions.
   */
  blocker?: string
  selection?: 'single' | 'multiple' | 'text' | 'confirm'
  options?: Array<{ id?: string; label: string; description?: string; recommended?: boolean }>
}

const selections = new Set(['single', 'multiple', 'text', 'confirm'])
const MAX_QUESTION_OPTIONS = 6

function nonEmptyString(value: unknown, limit = 400): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function readOptions(value: unknown): AgentBlockedQuestion['options'] {
  if (!Array.isArray(value)) return undefined
  const options: NonNullable<AgentBlockedQuestion['options']> = []
  for (const item of value) {
    if (options.length >= MAX_QUESTION_OPTIONS) break
    if (typeof item === 'string') {
      const label = nonEmptyString(item, 80)
      if (label) options.push({ label })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const label = nonEmptyString(raw.label ?? raw.title ?? raw.text, 80)
    if (!label) continue
    const id = nonEmptyString(raw.id, 40)
    const description = nonEmptyString(raw.description, 160)
    options.push({
      ...(id ? { id } : {}),
      label,
      ...(description ? { description } : {}),
      ...(raw.recommended === true ? { recommended: true } : {})
    })
  }
  return options.length > 0 ? options : undefined
}

/**
 * Read the optional `question` a model attaches to a `blocked` verdict.
 *
 * Models often state the missing piece only in `verification` / `final`. Those
 * are accepted as the question text so a blocked run always has something
 * concrete to ask, instead of depending on the model following the schema.
 */
export function readBlockedQuestion(
  instruction: unknown,
  fallback: string
): AgentBlockedQuestion | undefined {
  const record = instruction && typeof instruction === 'object' ? instruction as Record<string, unknown> : {}
  const raw = record.question ?? record.missingInformation ?? record.needs
  let question: string
  let title: string | undefined
  let blocker = nonEmptyString(record.blocker, 80)
  let selection: AgentBlockedQuestion['selection']
  let options: AgentBlockedQuestion['options']
  if (typeof raw === 'string') {
    question = nonEmptyString(raw)
  } else if (raw && typeof raw === 'object') {
    const nested = raw as Record<string, unknown>
    title = nonEmptyString(nested.title, 120) || undefined
    blocker = nonEmptyString(nested.blocker, 80) || blocker
    question = nonEmptyString(nested.question ?? nested.description ?? nested.text ?? nested.prompt)
    selection = selections.has(String(nested.selection)) ? nested.selection as AgentBlockedQuestion['selection'] : undefined
    options = readOptions(nested.options)
  } else {
    question = ''
  }
  if (!question) question = nonEmptyString(record.verification) || nonEmptyString(record.final)
  if (!question) question = fallback.trim()
  if (!question) return undefined
  return { question, ...(title ? { title } : {}), ...(blocker ? { blocker } : {}), ...(selection ? { selection } : {}), ...(options ? { options } : {}) }
}

/**
 * Why a run stopped to ask. The three cases look identical in code and nothing
 * alike to the person answering them:
 *
 * - `missing-info` — the run needs a fact only they have (a name, an address, a
 *   choice between two viable plans).
 * - `unconfirmed` — the model answered, but not in a form the client can check,
 *   so the question is "accept this or tell me what is wrong", not "add data".
 * - `provider` / `engine` — an upstream failure or a stalled step. Nothing the
 *   user types can help; only retrying or stopping can.
 *
 * Offering "I will add the missing information" in the last two is what made the
 * card impossible to answer: there was no missing information to add.
 */
export type AgentPauseReason = 'missing-info' | 'unconfirmed' | 'provider' | 'engine'

export interface AgentPauseChoice {
  id: string
  label: string
  description: string
}

export function pauseChoicesFor(reason: AgentPauseReason, language: 'zh' | 'en' = 'zh'): AgentPauseChoice[] {
  const en = language === 'en'
  if (reason === 'unconfirmed') {
    return en ? [
      { id: 'accept', label: 'Take this as done', description: 'I accept the answer above; close the task here' },
      { id: 'continue', label: 'Finish the missing part', description: 'Retry using the note I type below' },
      { id: 'pause', label: 'Stop here for now', description: 'Keep the work already done and resume later' }
    ] : [
      { id: 'accept', label: '就这样算完成', description: '我接受上面的答复，任务到此收尾' },
      { id: 'continue', label: '继续补完', description: '带着我下面写的补充再试一次' },
      { id: 'pause', label: '先停在这里', description: '保留已完成的工作，稍后继续' }
    ]
  }
  if (reason === 'provider' || reason === 'engine') {
    return en ? [
      { id: 'retry', label: 'Retry this step', description: 'Resume from the saved checkpoint without repeating finished work' },
      { id: 'pause', label: 'Stop here for now', description: 'Keep the work already done and resume later' }
    ] : [
      { id: 'retry', label: '再试这一步', description: '从已保存的进度重试，不重复已经完成的动作' },
      { id: 'pause', label: '先停在这里', description: '保留已完成的工作，稍后继续' }
    ]
  }
  return en ? [
    { id: 'provide', label: 'I will add the missing information', description: 'Type it in the box below and the task continues with it' },
    { id: 'retry', label: 'Continue another way', description: 'Do not wait for me; retry with a different approach' },
    { id: 'pause', label: 'Stop here for now', description: 'Keep the work already done and resume later' }
  ] : [
    { id: 'provide', label: '我来补充信息', description: '在下面直接填写缺少的信息，我会带着它继续' },
    { id: 'retry', label: '换一种方式继续', description: '不用等我，换一条可用路径再试一次' },
    { id: 'pause', label: '先停在这里', description: '保留已完成的工作，稍后继续' }
  ]
}

/** A title that states the situation, so the choices underneath it make sense. */
export function pauseTitleFor(reason: AgentPauseReason, language: 'zh' | 'en' = 'zh'): string {
  const en = language === 'en'
  if (reason === 'unconfirmed') return en ? 'The answer could not be verified' : '这一轮没通过自动核对'
  if (reason === 'provider') return en ? 'The model service did not answer' : '模型服务这次没有响应'
  if (reason === 'engine') return en ? 'This step stopped making progress' : '这一步没有取得进展'
  return en ? 'The task needs one more thing from you' : '需要你补充一点信息'
}
