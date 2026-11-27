/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  WORKSPACE_INTERACTION_TTL_MS,
  WorkspaceInteractionStore,
  describeInteractionAnswer,
  formatInteractionAnswer,
  isInteractionExpired,
  persistInteractionAnswer,
  normalizeInteractionRequest,
  normalizeInteractionResponse
} from './workspaceInteractions.ts'

const base = { conversationId: 'conv_1', taskId: 'message:m1', now: 1_700_000_000_000 }

test('normalizes a single-choice question with options and a recommendation', () => {
  const request = normalizeInteractionRequest({
    title: 'GitLab 认证失败',
    description: '请选择后续处理方式',
    selection: 'single',
    options: [
      { id: 'https', label: 'HTTPS + Access Token', recommended: true, description: '推荐，权限可控' },
      { label: 'SSH 认证' },
      { label: '暂不处理' }
    ]
  }, base)
  assert.equal(request.selection, 'single')
  assert.equal(request.options.length, 3)
  assert.equal(request.options[0].id, 'https')
  assert.equal(request.options[0].recommended, true)
  assert.equal(request.options[1].id, 'ssh-认证')
  assert.equal(request.allowCustom, true)
  assert.equal(request.allowSkip, true)
  assert.equal(request.expiresAt, base.now + WORKSPACE_INTERACTION_TTL_MS)
})

test('caps options, de-duplicates ids and degrades empty option lists to text input', () => {
  const many = normalizeInteractionRequest({
    selection: 'multiple',
    title: '选择对象',
    options: Array.from({ length: 12 }, (_, index) => ({ id: `same-${index % 2}`, label: `对象 ${index}` }))
  }, base)
  assert.ok(many.options.length <= 6)
  assert.equal(new Set(many.options.map((option) => option.id)).size, many.options.length)

  const empty = normalizeInteractionRequest({ selection: 'single', title: '请填写分支名' }, base)
  assert.equal(empty.selection, 'text')
  assert.equal(empty.allowCustom, true)
})

test('rejects unknown options and collapses a single selection to one answer', () => {
  const request = normalizeInteractionRequest({
    selection: 'single',
    title: '选择方案',
    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  }, base)
  const response = normalizeInteractionResponse(request, { selectedIds: ['a', 'b', 'nope'] })
  assert.deepEqual(response.selectedIds, ['a'])
  assert.equal(response.cancelled, false)

  const multi = normalizeInteractionRequest({
    selection: 'multiple',
    title: '选择文件',
    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  }, base)
  assert.deepEqual(normalizeInteractionResponse(multi, { selectedIds: ['a', 'b'] }).selectedIds, ['a', 'b'])
})

test('treats an empty answer as cancellation and formats answers for the model', () => {
  const request = normalizeInteractionRequest({
    selection: 'single',
    title: '选择方案',
    options: [{ id: 'https', label: 'HTTPS + Token' }, { id: 'ssh', label: 'SSH' }]
  }, base)
  const cancelled = normalizeInteractionResponse(request, { selectedIds: [] })
  assert.equal(cancelled.cancelled, true)
  assert.match(formatInteractionAnswer(request, cancelled, 'zh'), /取消了这次提问/)

  const answered = normalizeInteractionResponse(request, { selectedIds: ['https'], customText: '用只读 token' })
  const text = formatInteractionAnswer(request, answered, 'zh')
  assert.match(text, /HTTPS \+ Token \(https\)/)
  assert.match(text, /用只读 token/)
  assert.match(text, /不要再次询问/)
})

test('expires stale pending requests but never rewrites answered ones', () => {
  const request = normalizeInteractionRequest({ title: '请选择', selection: 'text' }, base)
  const record = { request, status: 'pending' as const }
  assert.equal(isInteractionExpired(record, base.now + 1000), false)
  assert.equal(isInteractionExpired(record, base.now + WORKSPACE_INTERACTION_TTL_MS + 1), true)
  assert.equal(isInteractionExpired({ ...record, status: 'answered' }, base.now + WORKSPACE_INTERACTION_TTL_MS + 1), false)
})

test('store persists requests, answers exactly once and survives reload', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gllm-interactions-'))
  try {
    const store = new WorkspaceInteractionStore(directory)
    const request = normalizeInteractionRequest({ title: '选择方案', options: ['A', 'B'] }, { conversationId: 'conv_1' })
    store.create(request)
    assert.equal(store.pending('conv_1').length, 1)
    assert.equal(store.pending('conv_2').length, 0)

    const response = normalizeInteractionResponse(request, { selectedIds: [request.options[0].id] })
    const resolved = store.resolve(request.id, response)
    assert.equal(resolved?.status, 'answered')
    assert.equal(store.resolve(request.id, response), undefined, 'repeat submissions are ignored')
    assert.equal(store.pending('conv_1').length, 0)

    const reloaded = new WorkspaceInteractionStore(directory)
    const record = reloaded.get(request.id)
    assert.equal(record?.status, 'answered')
    assert.deepEqual(record?.response?.selectedIds, [request.options[0].id])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('unanswered requests stay pending after a restart and expire later', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gllm-interactions-'))
  try {
    const store = new WorkspaceInteractionStore(directory)
    const now = Date.now()
    const request = normalizeInteractionRequest({ title: '等待回答', selection: 'text' }, { conversationId: 'conv_1', now })
    store.create(request)

    const restarted = new WorkspaceInteractionStore(directory)
    assert.equal(restarted.pending('conv_1', now + 1_000).length, 1)
    assert.equal(restarted.pending('conv_1', now + WORKSPACE_INTERACTION_TTL_MS + 1).length, 0)
    assert.equal(restarted.get(request.id)?.status, 'expired')
    assert.equal(restarted.resolve(request.id, normalizeInteractionResponse(request, { customText: 'late' })), undefined)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('re-creating an answered request keeps the stored answer', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gllm-interactions-'))
  try {
    const store = new WorkspaceInteractionStore(directory)
    const request = normalizeInteractionRequest({ title: '选择方案', options: ['A', 'B'] }, { conversationId: 'conv_1' })
    store.create(request)
    store.resolve(request.id, normalizeInteractionResponse(request, { selectedIds: [request.options[0].id] }))
    const recreated = store.create(request)
    assert.equal(recreated.status, 'answered')
    assert.equal(store.pending('conv_1').length, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('confirm answers are formatted as an explicit go-ahead', () => {
  const request = normalizeInteractionRequest({ title: '继续执行？', selection: 'confirm' }, base)
  const response = normalizeInteractionResponse(request, {})
  assert.equal(response.cancelled, false)
  assert.match(formatInteractionAnswer(request, response, 'zh'), /确认继续/)
})

test('cancel marks a pending request and blocks later answers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gllm-interactions-'))
  try {
    const store = new WorkspaceInteractionStore(directory)
    const request = normalizeInteractionRequest({ title: '选择方案', options: ['A', 'B'] }, { conversationId: 'conv_1' })
    store.create(request)
    assert.equal(store.cancel(request.id), true)
    assert.equal(store.cancel(request.id), false)
    assert.equal(store.resolve(request.id, normalizeInteractionResponse(request, { selectedIds: [request.options[0].id] })), undefined)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// The IPC handler resolves the in-flight promise first. Before this, it then
// returned without touching the store, so the record stayed `pending` and the
// next load offered the same question again — the user answered the same thing
// over and over while every answer looked accepted.
test('an answer consumed by a live waiter is still persisted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gllm-interactions-persist-'))
  try {
    const store = new WorkspaceInteractionStore(dir)
    // Real clock: a request older than the 24h TTL is expired on read, which
    // would make this test pass for the wrong reason.
    const now = Date.now()
    const request = normalizeInteractionRequest(
      { title: '提交身份未配置，如何继续', options: [{ id: 'diy', label: '我自己配置' }], selection: 'single' },
      { ...base, now }
    )
    store.create(request)
    const response = normalizeInteractionResponse(request, { selectedIds: ['diy'], answeredAt: now + 1000 })

    assert.equal(persistInteractionAnswer(store, request.id, response), true)
    assert.equal(store.get(request.id)?.status, 'answered')
    assert.deepEqual(store.pending('conv_1'), [], 'an answered question must not be offered again')
    // A second click on the same card must not rewrite a settled record.
    assert.equal(persistInteractionAnswer(store, request.id, response), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// The run injects `[用户回答]` into the model's private messages only, so the
// transcript lost every choice the user made. The transcript line is derived
// from the request and the response, not from the model's summary.
test('the answer is rendered as a transcript line', () => {
  const request = normalizeInteractionRequest(
    {
      title: '根仓库本地改动如何处理',
      options: [{ id: 'commit-push', label: '提交并推送' }, { id: 'keep', label: '先保留' }],
      selection: 'single'
    },
    base
  )
  const response = normalizeInteractionResponse(request, { selectedIds: ['commit-push'], answeredAt: base.now })
  assert.equal(describeInteractionAnswer(request, response), '已回答「根仓库本地改动如何处理」\n选择：提交并推送')

  const withNote = normalizeInteractionResponse(request, { customText: '改用 squash 再推', answeredAt: base.now })
  assert.equal(describeInteractionAnswer(request, withNote), '已回答「根仓库本地改动如何处理」\n补充：改用 squash 再推')
  assert.equal(describeInteractionAnswer(request, { ...response, cancelled: true }), '')
})
