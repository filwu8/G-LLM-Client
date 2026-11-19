/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { AgentExecutionPlan, AgentPlanStep, AgentPlanStepStatus } from './types'

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
  outcome: 'succeeded' | 'failed',
  verification: string,
  now = Date.now()
): AgentExecutionPlan {
  return {
    ...plan,
    status: outcome,
    verification: verification.trim().slice(0, 1000),
    completedAt: now,
    steps: plan.steps.map((step) => {
      if (step.managedBy === 'model') {
        // A successful run must not fabricate completion for steps the model left
        // pending; only a step still marked running is settled by the outcome.
        return step.status === 'running' ? { ...step, status: 'completed' as const } : step
      }
      if (outcome === 'succeeded') return { ...step, status: 'completed' as const }
      if (step.status === 'running') return { ...step, status: 'failed' as const }
      return step
    })
  }
}

const MODEL_STEP_PREFIX = 'todo_'
const MODEL_STEP_LIMIT = 20

export interface AgentModelStepInput {
  subject: string
  activeForm?: string
}

/** Steps the model owns through the todo tool. Fixed phases are excluded. */
export function modelPlanSteps(plan: AgentExecutionPlan): AgentPlanStep[] {
  return plan.steps.filter((step) => step.managedBy === 'model')
}

/**
 * Replace the model-owned steps. Fixed phases survive untouched so rebuilding
 * the checklist never disturbs the run's own phase tracking.
 */
export function setModelSteps(plan: AgentExecutionPlan, tasks: AgentModelStepInput[]): AgentExecutionPlan {
  const steps: AgentPlanStep[] = tasks.slice(0, MODEL_STEP_LIMIT).map((task, index) => ({
    id: `${MODEL_STEP_PREFIX}${index + 1}`,
    title: task.subject,
    status: 'pending' as const,
    managedBy: 'model' as const,
    ...(task.activeForm ? { activeForm: task.activeForm } : {})
  }))
  return { ...plan, steps: [...plan.steps.filter((step) => step.managedBy !== 'model'), ...steps] }
}

/**
 * Update one model step. Starting a step stops whichever step was running
 * instead of failing: a model that forgets to close the previous step should not
 * burn a whole turn on the error.
 */
export function updateModelStep(plan: AgentExecutionPlan, id: string, status: AgentPlanStepStatus): AgentExecutionPlan {
  if (!plan.steps.some((step) => step.managedBy === 'model' && step.id === id)) throw new Error(`Unknown todo step: ${id}`)
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      if (step.managedBy !== 'model') return step
      if (step.id === id) return { ...step, status }
      return status === 'running' && step.status === 'running' ? { ...step, status: 'pending' as const } : step
    })
  }
}

export function removeModelStep(plan: AgentExecutionPlan, id: string): AgentExecutionPlan {
  return { ...plan, steps: plan.steps.filter((step) => !(step.managedBy === 'model' && step.id === id)) }
}

/** Re-attach a persisted checklist. An interrupted step restarts as pending. */
export function restoreModelSteps(plan: AgentExecutionPlan, steps: AgentPlanStep[]): AgentExecutionPlan {
  const restored = steps.slice(0, MODEL_STEP_LIMIT).map((step) => ({
    ...step,
    managedBy: 'model' as const,
    status: step.status === 'running' ? 'pending' as const : step.status
  }))
  return { ...plan, steps: [...plan.steps.filter((step) => step.managedBy !== 'model'), ...restored] }
}

/** Unfinished model steps, used to block a premature completed verdict. */
export function unfinishedModelSteps(plan: AgentExecutionPlan): AgentPlanStep[] {
  return plan.steps.filter((step) => step.managedBy === 'model' && (step.status === 'pending' || step.status === 'running'))
}
