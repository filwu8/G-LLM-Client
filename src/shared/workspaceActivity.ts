/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { WorkspaceToolActivity } from './types'

/**
 * Tool id used by the workspace agent for model-request retries. Both the
 * in-request retry loop and the continuation reconnect ladder write this id, so
 * the renderer can collapse them into one visible notice instead of a wall of
 * identical rows.
 */
export const MODEL_RETRY_TOOL = 'model_request_retry'

export function isModelRetryActivity(activity: WorkspaceToolActivity): boolean {
  return activity.tool === MODEL_RETRY_TOOL
}

export interface ModelRetrySummary {
  /** How many retry attempts were recorded for this run. */
  count: number
  /** The attempt currently in flight, when the run is still retrying. */
  running?: WorkspaceToolActivity
  /** The most recent attempt, running or finished. */
  latest: WorkspaceToolActivity
  status: 'running' | 'completed' | 'failed'
  /** Remote endpoint the request is aimed at, e.g. `llm.gprophet.com`. */
  endpoint?: string
  /** When the first retry of this run started, so the UI can show the wait. */
  since?: number
  /** Distinct failure reasons, newest first, without duplicates. */
  reasons: string[]
}

/**
 * Collapse the retry activities of one run into a single summary.
 *
 * A dead upstream produces one activity per attempt — 32 identical "自动重试
 * 模型请求" rows in the observed outage — which buries the rest of the log. The
 * summary keeps the count and the endpoint so the UI can show one line and
 * reveal the detail on demand.
 */
export function summarizeModelRetries(
  activities: readonly WorkspaceToolActivity[]
): ModelRetrySummary | undefined {
  const retries = activities.filter(isModelRetryActivity)
  if (retries.length === 0) return undefined

  const latest = retries[retries.length - 1]
  const running = retries.find((activity) => activity.status === 'running')
  const reasons: string[] = []
  for (const activity of retries) {
    const reason = activity.detail?.trim()
    if (reason && !reasons.includes(reason)) reasons.unshift(reason)
  }

  const starts = retries.map((activity) => activity.startedAt).filter((value): value is number => typeof value === 'number')
  return {
    count: retries.length,
    running,
    latest,
    since: starts.length > 0 ? Math.min(...starts) : undefined,
    status: running ? 'running' : latest.status === 'failed' ? 'failed' : 'completed',
    endpoint: retries.map((activity) => activity.endpoint?.trim()).filter(Boolean)[0] || undefined,
    reasons
  }
}

/**
 * Keep only the fields the app understands, so a hand-edited or older store
 * cannot smuggle junk into the renderer. Shared by both places that persist
 * activities (live messages and retry snapshots).
 */
export function sanitizeWorkspaceActivity(
  activity: WorkspaceToolActivity,
  fallbackId = 'activity'
): WorkspaceToolActivity {
  const endpoint = activity.endpoint ? String(activity.endpoint).trim().slice(0, 120) : ''
  return {
    id: String(activity.id ?? '').trim() || `${fallbackId}_${Date.now()}`,
    tool: String(activity.tool ?? '').trim(),
    label: String(activity.label ?? '').trim() || '工作区操作',
    status: activity.status === 'running' || activity.status === 'failed' ? activity.status : 'completed',
    detail: activity.detail ? String(activity.detail).slice(0, 500) : undefined,
    endpoint: endpoint || undefined
  }
}
