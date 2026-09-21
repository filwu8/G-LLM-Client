/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */

export interface WorkspaceChatCompletionToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface WorkspaceChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: unknown
  tool_call_id?: string
  tool_calls?: WorkspaceChatCompletionToolCall[]
}

export interface WorkspaceChatCompletionRequestInput {
  model: string
  messages: unknown[]
  stream: boolean
  temperature: number
  tools?: unknown[]
  reasoningEffort?: string
  maxTokenOption?: Record<string, unknown>
}

/** Build only the Chat Completions wire shape. Responses API fields/events belong
 * to a separate adapter and must not be mixed into workspace-agent requests. */
export function buildWorkspaceChatCompletionRequest(input: WorkspaceChatCompletionRequestInput): Record<string, unknown> {
  return {
    ...input.maxTokenOption,
    model: input.model,
    messages: input.messages,
    ...(input.tools ? { tools: input.tools, tool_choice: 'auto' } : {}),
    ...(input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
    stream: input.stream,
    temperature: input.temperature
  }
}

export function appendWorkspaceAssistantToolCalls(
  messages: WorkspaceChatCompletionMessage[],
  content: unknown,
  toolCalls: WorkspaceChatCompletionToolCall[]
): void {
  messages.push({ role: 'assistant', content, tool_calls: toolCalls })
}

export function appendWorkspaceToolResult(
  messages: WorkspaceChatCompletionMessage[],
  callId: string,
  content: unknown
): void {
  messages.push({ role: 'tool', tool_call_id: callId, content })
}

export function formatWorkspaceToolResult(output: string, exitCode?: number): string {
  return exitCode !== undefined && exitCode !== 0
    ? `Tool error (exit code ${exitCode}):\n${output}`
    : output
}

/** Per-run side-effect ledger. A claimed ID remains claimed even if execution
 * throws, because its external side-effect state may be uncertain. */
export class WorkspaceToolCallLedger {
  private readonly entries = new Map<string, { state: 'running' } | { state: 'completed'; result: string }>()

  claim(callId: string): boolean {
    if (this.entries.has(callId)) return false
    this.entries.set(callId, { state: 'running' })
    return true
  }

  complete(callId: string, result: string): void {
    if (this.entries.has(callId)) this.entries.set(callId, { state: 'completed', result })
  }

  replayResult(callId: string): string | undefined {
    const entry = this.entries.get(callId)
    return entry?.state === 'completed' ? entry.result : undefined
  }

  wasClaimed(callId: string): boolean {
    return this.entries.has(callId)
  }
}

export interface WorkspaceModelAttempt<T> {
  status: number
  value: T
}

export interface WorkspaceModelAttemptInfo {
  attempt: number
  maxAttempts: number
  status: number
  identity: { runId: string; requestId: string; attemptId: string }
  nextAttemptId: string
}

/** Retries only explicit HTTP statuses known to be rejected. Thrown transport,
 * timeout, and incomplete-stream errors propagate without replay. */
export async function runWorkspaceModelAttempts<T>(options: {
  runId: string
  requestId: string
  firstAttemptId: string
  maxAttempts: number
  retryableStatuses: ReadonlySet<number>
  createAttemptId: () => string
  runAttempt: (identity: { runId: string; requestId: string; attemptId: string }, attempt: number) => Promise<WorkspaceModelAttempt<T>>
  onAttempt?: (identity: { runId: string; requestId: string; attemptId: string }, attempt: number, maxAttempts: number) => void
  beforeRetry?: (info: WorkspaceModelAttemptInfo) => Promise<void>
}): Promise<WorkspaceModelAttempt<T>> {
  let attemptId = options.firstAttemptId
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const identity = { runId: options.runId, requestId: options.requestId, attemptId }
    options.onAttempt?.(identity, attempt, options.maxAttempts)
    const result = await options.runAttempt(identity, attempt)
    if (!options.retryableStatuses.has(result.status) || attempt === options.maxAttempts) return result
    const nextAttemptId = options.createAttemptId()
    await options.beforeRetry?.({ attempt, maxAttempts: options.maxAttempts, status: result.status, identity, nextAttemptId })
    attemptId = nextAttemptId
  }
  throw new Error('模型请求阶段失败：已达到自动重试上限')
}
