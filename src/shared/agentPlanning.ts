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
  let selection: AgentBlockedQuestion['selection']
  let options: AgentBlockedQuestion['options']
  if (typeof raw === 'string') {
    question = nonEmptyString(raw)
  } else if (raw && typeof raw === 'object') {
    const nested = raw as Record<string, unknown>
    title = nonEmptyString(nested.title, 120) || undefined
    question = nonEmptyString(nested.question ?? nested.description ?? nested.text ?? nested.prompt)
    selection = selections.has(String(nested.selection)) ? nested.selection as AgentBlockedQuestion['selection'] : undefined
    options = readOptions(nested.options)
  } else {
    question = ''
  }
  if (!question) question = nonEmptyString(record.verification) || nonEmptyString(record.final)
  if (!question) question = fallback.trim()
  if (!question) return undefined
  return { question, ...(title ? { title } : {}), ...(selection ? { selection } : {}), ...(options ? { options } : {}) }
}
