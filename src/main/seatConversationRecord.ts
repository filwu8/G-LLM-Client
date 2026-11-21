/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import type {
  AgentExecutionPlan,
  ChatMessage,
  ContextSavings,
  Conversation,
  WorkspaceToolActivity
} from '../shared/types'

/** A seat keeps one conversation per console conversation, so repeated dispatch aggregates instead of flooding the sidebar. */
export function seatConversationId(parentConversationId: string, seatId: string): string {
  return `${parentConversationId}::${seatId}`
}

/** The sidebar entry is named after the work, truncated, so a user can tell dispatches apart. */
export function seatConversationTitle(seatName: string, task: string): string {
  return `${seatName} · ${task.replace(/\s+/g, ' ').trim().slice(0, 22)}`
}

export interface SeatConversationSeat {
  id: string
  name: string
  modelProviderId?: string
  modelId?: string
}

export interface SeatRunOutcome {
  content: string
  activities?: WorkspaceToolActivity[]
  changedFiles?: string[]
  plan?: AgentExecutionPlan
  contextSavings?: ContextSavings
  outputTokens?: number
}

export interface SeatConversationInput {
  existing?: Conversation | null
  parentConversationId: string
  parentAssistantId: string
  seat: SeatConversationSeat
  workspace: Conversation['workspace']
  runId: string
  task: string
  startedAt: number
  now: number
  /** Omitted while the run is still going: the record exists so the user can open it mid-run. */
  outcome?: SeatRunOutcome
}

/**
 * Builds the seat's record for one dispatch. Both the dispatch-time entry and the
 * final record go through here, so a failed or interrupted run still leaves the
 * task and every step it managed to take on the seat's side.
 */
export function buildSeatConversation(input: SeatConversationInput): Conversation {
  const conversationId = seatConversationId(input.parentConversationId, input.seat.id)
  const taskId = `seat_task_${input.runId}`
  const replyId = `seat_run_${input.runId}`
  // Re-saving the same run must not duplicate its messages.
  const previous = (input.existing?.messages ?? []).filter(message => message.id !== taskId && message.id !== replyId)
  const taskMessage: ChatMessage = {
    id: taskId,
    role: 'user',
    content: input.task,
    createdAt: input.startedAt
  }
  const messages: ChatMessage[] = [...previous, taskMessage]
  const outputTokens = input.outcome ? input.outcome.outputTokens ?? 0 : 0
  if (input.outcome) {
    messages.push({
      id: replyId,
      role: 'assistant',
      content: input.outcome.content,
      createdAt: input.now,
      outputTokens,
      tokenCount: outputTokens,
      responseStartedAt: input.startedAt,
      responseCompletedAt: input.now,
      workspaceActivities: input.outcome.activities,
      workspaceChangedFiles: input.outcome.changedFiles,
      workspaceArtifactRoot: input.workspace?.rootPath,
      agentPlan: input.outcome.plan,
      contextSavings: input.outcome.contextSavings
    })
  }
  return {
    id: conversationId,
    assistantId: input.seat.id,
    title: seatConversationTitle(input.seat.name, input.task),
    messages,
    modelProviderId: input.seat.modelProviderId,
    modelId: input.seat.modelId,
    delegatedFrom: { assistantId: input.parentAssistantId, conversationId: input.parentConversationId },
    workspace: input.workspace,
    totalTokens: (input.existing?.totalTokens ?? 0) + outputTokens,
    totalOutputTokens: (input.existing?.totalOutputTokens ?? 0) + outputTokens,
    createdAt: input.existing?.createdAt ?? input.startedAt,
    updatedAt: input.now
  }
}
