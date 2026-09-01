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
      if (outcome === 'succeeded') return { ...step, status: 'completed' as const }
      if (step.status === 'running') return { ...step, status: 'failed' as const }
      return step
    })
  }
}
