/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { isModelRetryActivity, sanitizeWorkspaceActivity, summarizeModelRetries } from './workspaceActivity.ts'
import type { WorkspaceToolActivity } from './types'

function retry(id: string, status: WorkspaceToolActivity['status'], extra: Partial<WorkspaceToolActivity> = {}): WorkspaceToolActivity {
  return { id, tool: 'model_request_retry', label: '模型重试中（第 1/4 次）', status, ...extra }
}

test('a run without retries has no notice', () => {
  const activities: WorkspaceToolActivity[] = [
    { id: 'a', tool: 'write_file', label: '写入文件', status: 'completed' }
  ]
  assert.equal(summarizeModelRetries(activities), undefined)
  assert.equal(isModelRetryActivity(activities[0]), false)
})

test('repeated retries collapse into one summary that keeps the count and endpoint', () => {
  // The observed outage wrote one row per attempt: 32 identical lines that
  // pushed every real operation out of the compact view.
  const activities: WorkspaceToolActivity[] = [
    { id: 'w', tool: 'write_file', label: '写入文件', status: 'completed' },
    ...Array.from({ length: 32 }, (_, index) => retry(`r${index}`, index === 31 ? 'running' : 'completed', {
      endpoint: 'llm.gprophet.com',
      detail: index === 31 ? '模型网关暂时无法连接上游服务（502）' : '模型连接暂时中断，稍后从已有进度继续。'
    }))
  ]

  const summary = summarizeModelRetries(activities)
  assert.ok(summary)
  assert.equal(summary.count, 32, 'every attempt is counted')
  assert.equal(summary.status, 'running', 'the notice follows the attempt in flight')
  assert.equal(summary.running?.id, 'r31')
  assert.equal(summary.endpoint, 'llm.gprophet.com', 'the user must be able to see who is being called')
  assert.equal(summary.reasons.length, 2, 'the same reason repeated 31 times is listed once')
  assert.match(summary.reasons[0], /502/, 'the newest reason comes first')
})

test('the wait is measured from the first retry, not from the current attempt', () => {
  const summary = summarizeModelRetries([
    retry('a', 'completed', { startedAt: 1_000 }),
    retry('b', 'completed', { startedAt: 25_000 }),
    retry('c', 'running', { startedAt: 70_000 })
  ])
  assert.equal(summary?.since, 1_000, 'a counter that resets every attempt hides a two-minute wait')
})

test('a finished run reports failure only when the last attempt failed', () => {
  const recovered = summarizeModelRetries([retry('a', 'completed'), retry('b', 'completed')])
  assert.equal(recovered?.status, 'completed')
  assert.equal(recovered?.running, undefined)

  const failed = summarizeModelRetries([retry('a', 'completed'), retry('b', 'failed')])
  assert.equal(failed?.status, 'failed')
})

test('the endpoint survives persistence and junk is dropped', () => {
  const stored = sanitizeWorkspaceActivity({
    id: '  ',
    tool: 'model_request_retry',
    label: '',
    status: 'running',
    detail: 'x'.repeat(900),
    endpoint: '  llm.gprophet.com  '
  })
  assert.match(stored.id, /^activity_/, 'an empty id is replaced so React keys stay unique')
  assert.equal(stored.label, '工作区操作')
  assert.equal(stored.endpoint, 'llm.gprophet.com')
  assert.equal(stored.detail?.length, 500, 'detail stays bounded')

  const invalid = sanitizeWorkspaceActivity({ id: 'b', tool: 't', label: 'l', status: 'pending' as never })
  assert.equal(invalid.status, 'completed', 'an unknown status must not render as running forever')
  assert.equal(invalid.endpoint, undefined, 'no endpoint means "unknown", not an empty chip')
})
