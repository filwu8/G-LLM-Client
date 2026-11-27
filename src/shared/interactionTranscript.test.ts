/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canEditTranscriptMessage,
  describeInteractionAnswer,
  interactionAnswerMessage,
  interactionAnswerMessageId,
  isInteractionAnswerMessageId,
  isLatestUserTurn
} from './interactionTranscript.ts'
import type { ChatMessage, WorkspaceInteractionRequest, WorkspaceInteractionResponse } from './types.ts'

function question(overrides: Partial<WorkspaceInteractionRequest> = {}): WorkspaceInteractionRequest {
  return {
    id: '622149b7-9eec-44cc-b4fe-596d2509c33b',
    conversationId: 'conv_1',
    kind: 'question',
    title: '本地分支 backup/local-20261117 如何处理',
    description: '根仓库的本地分支只有本机有。',
    selection: 'single',
    options: [
      { id: 'keep', label: '保留分支不动', recommended: true },
      { id: 'reset', label: '把分支重置到 origin/main' }
    ],
    createdAt: 1_795_777_699_894,
    expiresAt: 1_795_864_099_894,
    ...overrides
  } as WorkspaceInteractionRequest
}

function answer(overrides: Partial<WorkspaceInteractionResponse> = {}): WorkspaceInteractionResponse {
  return {
    id: '622149b7-9eec-44cc-b4fe-596d2509c33b',
    selectedIds: ['keep'],
    cancelled: false,
    answeredAt: 1_795_777_768_928,
    ...overrides
  }
}

test('the answer message id is derived from the question, so two writers agree', () => {
  assert.equal(interactionAnswerMessageId('abc'), 'msg_answer_abc')
  assert.equal(interactionAnswerMessageId('abc'), interactionAnswerMessageId('abc'))
  assert.equal(isInteractionAnswerMessageId(interactionAnswerMessageId('abc')), true)
  assert.equal(isInteractionAnswerMessageId('msg_1795777598952_ad1ab6800a78b8'), false)
})

test('an answered question leaves a readable line in the transcript', () => {
  // The ERPv3 sync run answered this exact question and the conversation showed
  // nothing afterwards: the card closed and the choice was only in the model's
  // private messages.
  assert.equal(
    describeInteractionAnswer(question(), answer()),
    '已回答「本地分支 backup/local-20261117 如何处理」\n选择：保留分支不动'
  )
  assert.equal(
    describeInteractionAnswer(question(), answer({ customText: '先把提交推到远端备份' })),
    '已回答「本地分支 backup/local-20261117 如何处理」\n选择：保留分支不动\n补充：先把提交推到远端备份'
  )
  // An unknown option id must not silently render an empty "选择：".
  assert.equal(describeInteractionAnswer(question(), answer({ selectedIds: ['ghost'] })), '')
  assert.equal(describeInteractionAnswer(question(), answer({ cancelled: true })), '')
})

test('a dismissed question writes nothing, a confirmation writes a line', () => {
  const confirm = question({ selection: 'confirm', title: '继续执行收尾' })
  assert.equal(describeInteractionAnswer(confirm, { id: confirm.id, selectedIds: [], cancelled: false, answeredAt: 1 }), '已回答「继续执行收尾」')
  assert.equal(describeInteractionAnswer(question({ selection: 'text' }), { id: 'x', selectedIds: [], cancelled: false, answeredAt: 1 }), '')
})

test('the transcript message carries the stable id and the question text', () => {
  const message = interactionAnswerMessage(question(), answer(), 'zh', 1_700_000_000_000)
  assert.ok(message)
  assert.equal(message.id, interactionAnswerMessageId('622149b7-9eec-44cc-b4fe-596d2509c33b'))
  assert.equal(message.role, 'user')
  assert.equal(message.createdAt, 1_700_000_000_000)
  assert.match(message.content, /保留分支不动/)
  // Nothing to say means no message at all, so an empty bubble never appears.
  assert.equal(interactionAnswerMessage(question(), answer({ cancelled: true })), undefined)
})

test('an answer record is a receipt, so it cannot be edited and resent', () => {
  // The bubble looked like a user turn and offered "编辑并重发". Editing it would
  // put words in the user's mouth after the fact and resend them as a fresh
  // prompt, which is not what a record of a decision is for.
  assert.equal(canEditTranscriptMessage(message('msg_1795777598952_ad1ab6800a78b8')), true)
  assert.equal(canEditTranscriptMessage(message(interactionAnswerMessageId('q1'))), false)
  // Assistant output was never editable either; that must not change.
  assert.equal(canEditTranscriptMessage(message('msg_reply', 'assistant')), false)
})

function message(id: string, role: ChatMessage['role'] = 'user'): ChatMessage {
  return { id, role, content: id, createdAt: 0 }
}

test('a run stays current while the only thing after the request is its own answer record', () => {
  const request = message('msg_request', 'user')
  const answerRecord = message(interactionAnswerMessageId('q1'))
  // Without the exemption the runner treated its own answer record as a newer
  // user turn: every run that asked a question died with 任务已停止 afterwards.
  assert.equal(isLatestUserTurn([request], request.id), true)
  assert.equal(isLatestUserTurn([request, answerRecord], request.id), true)
  assert.equal(
    isLatestUserTurn([request, answerRecord, message(interactionAnswerMessageId('q2'))], request.id),
    true
  )
})

test('a genuinely newer user turn still invalidates the stored run', () => {
  const request = message('msg_request', 'user')
  assert.equal(isLatestUserTurn([request, message('msg_request_2')], request.id), false)
  assert.equal(isLatestUserTurn([request, message(interactionAnswerMessageId('q1')), message('msg_request_2')], request.id), false)
  // An assistant reply already written for this run means the result was saved.
  assert.equal(isLatestUserTurn([request, message('workspace_run1', 'assistant')], request.id), false)
  assert.equal(isLatestUserTurn([message('msg_request_2')], request.id), false)
})
