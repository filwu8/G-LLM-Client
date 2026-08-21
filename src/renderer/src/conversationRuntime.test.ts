/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acknowledgeConversationRun,
  finishConversationRun,
  isConversationRunning,
  removeConversationRun,
  startConversationRun,
  syncConversationUpdateIntoStreamingDrafts
} from './conversationRuntime.ts'
import type { Conversation } from '../../shared/types.ts'

test('tracks simultaneous model responses independently by conversation', () => {
  let states = startConversationRun({}, 'conversation-a', 10)
  states = startConversationRun(states, 'conversation-b', 20)

  assert.equal(isConversationRunning(states, 'conversation-a'), true)
  assert.equal(isConversationRunning(states, 'conversation-b'), true)

  states = finishConversationRun(states, 'conversation-a', 'conversation-b', 'completed', 30)
  assert.equal(states['conversation-a'].status, 'completed')
  assert.equal(isConversationRunning(states, 'conversation-b'), true)

  states = acknowledgeConversationRun(states, 'conversation-a')
  assert.equal(states['conversation-a'], undefined)
  assert.equal(isConversationRunning(states, 'conversation-b'), true)
})

test('active completion returns to idle while background errors remain visible', () => {
  let states = startConversationRun({}, 'active', 10)
  states = startConversationRun(states, 'background', 20)
  states = finishConversationRun(states, 'active', 'active', 'completed', 30)
  states = finishConversationRun(states, 'background', 'active', 'error', 40)

  assert.equal(states.active, undefined)
  assert.equal(states.background.status, 'error')

  states = removeConversationRun(states, 'background')
  assert.deepEqual(states, {})
})

test('keeps a model change in the live streaming draft', () => {
  const oldDraft: Conversation = {
    id: 'conversation-a',
    assistantId: 'assistant-a',
    title: 'test',
    messages: [],
    modelProviderId: 'provider-gllm',
    modelId: 'nvidia/old-model',
    createdAt: 10,
    updatedAt: 10
  }
  const changedConversation: Conversation = {
    ...oldDraft,
    modelId: 'gpt-5.5',
    updatedAt: 20
  }

  const drafts = syncConversationUpdateIntoStreamingDrafts(
    { [oldDraft.id]: oldDraft },
    changedConversation
  )

  assert.equal(drafts[oldDraft.id].modelId, 'gpt-5.5')
  assert.equal(drafts[oldDraft.id].updatedAt, 20)
})

test('does not create a streaming draft for an idle conversation update', () => {
  const conversation: Conversation = {
    id: 'conversation-idle',
    assistantId: 'assistant-a',
    title: 'test',
    messages: [],
    modelId: 'gpt-5.5',
    createdAt: 10,
    updatedAt: 20
  }
  const drafts = {}

  assert.equal(syncConversationUpdateIntoStreamingDrafts(drafts, conversation), drafts)
})
