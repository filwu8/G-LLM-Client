/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { modelPlanSteps } from '../shared/agentPlanning.ts'
import type { WorkspaceAgentProgress, WorkspaceToolActivity } from '../shared/types.ts'

export interface SeatProgressForwarderInput {
  parentConversationId: string
  seatConversationId: string
  seatAssistantId: string
  seatName: string
  isEnglish: boolean
  /** The console's own activity for this delegation, reused so one seat run shows as one live line. */
  entry?: WorkspaceToolActivity
  onProgress?: (progress: WorkspaceAgentProgress) => void
}

/**
 * Only the console's own progress belongs on its run record. A seat's steps are logged
 * under the seat's conversation id, and the console's reused summary line is a progress
 * snapshot, not a new `delegate_assistant` call.
 */
export function shouldBookParentRun(progress: WorkspaceAgentProgress, parentConversationId: string): boolean {
  if (progress.conversationId !== parentConversationId) return false
  return !progress.activity.delegatedStep
}

/**
 * One seat step produces two streams: the seat sees the step verbatim under its own
 * conversation id, while the console only gets one reused line carrying a step
 * counter, so a long seat run never floods the console with its chatter.
 */
export function createSeatProgressForwarder(
  input: SeatProgressForwarderInput
): (progress: WorkspaceAgentProgress) => void {
  const { entry, onProgress } = input
  let stepCount = 0
  return (progress) => {
    if (!onProgress) return
    // The renderer caches activities per conversation id, so the raw step already
    // lands on the seat's own record.
    onProgress(progress)
    if (!entry || progress.conversationId !== input.seatConversationId) return
    stepCount += 1
    if (progress.plan) {
      const steps = modelPlanSteps(progress.plan)
      if (steps.length) entry.steps = steps
    }
    const checklist = entry.steps?.length
      ? `${input.isEnglish ? 'checklist' : '清单'} ${entry.steps.filter(step => step.status === 'completed').length}/${entry.steps.length}`
      : ''
    const stepLabel = input.isEnglish ? `step ${stepCount}` : `第 ${stepCount} 步`
    entry.seat = input.seatName
    entry.seatAssistantId = input.seatAssistantId
    entry.seatConversationId = input.seatConversationId
    // The console must not book each seat step as its own delegate_assistant call.
    entry.delegatedStep = true
    entry.status = 'running'
    entry.detail = [checklist, stepLabel, progress.activity.label].filter(Boolean).join(' · ')
    onProgress({ conversationId: input.parentConversationId, activity: { ...entry } })
  }
}
