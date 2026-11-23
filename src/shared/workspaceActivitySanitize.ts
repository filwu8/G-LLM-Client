/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import type { AgentPlanStep, WorkspaceToolActivity } from './types'

/** The step's command/code and its real output are what make a stored seat record readable. */
const ACTIVITY_TEXT_LIMIT = 20_000
const ACTIVITY_DETAIL_LIMIT = 500
const ACTIVITY_FILE_LIMIT = 50
const ACTIVITY_STEP_LIMIT = 40

function bounded(value: string | undefined, limit: number): string | undefined {
  return value ? String(value).slice(0, limit) : undefined
}

function sanitizeStep(step: AgentPlanStep): AgentPlanStep {
  return {
    id: String(step.id ?? '').trim(),
    title: String(step.title ?? '').trim(),
    status: step.status,
    detail: bounded(step.detail, ACTIVITY_DETAIL_LIMIT),
    managedBy: step.managedBy === 'model' ? 'model' : undefined,
    activeForm: bounded(step.activeForm, ACTIVITY_DETAIL_LIMIT)
  }
}

/**
 * Persists a workspace step without dropping what the user needs to audit it: the
 * command or arguments it ran, its output, which seat ran it, and the jump target.
 * Labels alone turn a saved seat record into an unreadable list of "已完成".
 */
export function sanitizeWorkspaceActivity(activity: WorkspaceToolActivity, now = Date.now()): WorkspaceToolActivity {
  const directFiles = activity.files?.map(String).filter(Boolean).slice(0, ACTIVITY_FILE_LIMIT)
  return {
    id: String(activity.id ?? '').trim() || `activity_${now}`,
    tool: String(activity.tool ?? '').trim(),
    label: String(activity.label ?? '').trim() || '工作区操作',
    status: activity.status === 'running' || activity.status === 'failed' ? activity.status : 'completed',
    detail: bounded(activity.detail, ACTIVITY_DETAIL_LIMIT),
    input: bounded(activity.input, ACTIVITY_TEXT_LIMIT),
    output: bounded(activity.output, ACTIVITY_TEXT_LIMIT),
    startedAt: Number.isFinite(activity.startedAt) ? Number(activity.startedAt) : undefined,
    endedAt: Number.isFinite(activity.endedAt) ? Number(activity.endedAt) : undefined,
    files: directFiles?.length ? directFiles : undefined,
    // Without these the console transcript loses the seat badge and the jump button
    // after a restart, leaving only the live panel working.
    seat: bounded(activity.seat, ACTIVITY_DETAIL_LIMIT),
    seatAssistantId: bounded(activity.seatAssistantId, ACTIVITY_DETAIL_LIMIT),
    seatConversationId: bounded(activity.seatConversationId, ACTIVITY_DETAIL_LIMIT),
    delegatedStep: activity.delegatedStep || undefined,
    steps: activity.steps?.length ? activity.steps.slice(0, ACTIVITY_STEP_LIMIT).map(sanitizeStep) : undefined
  }
}
