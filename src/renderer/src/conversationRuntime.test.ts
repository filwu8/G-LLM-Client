/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acknowledgeConversationRun,
  attachDraftWorkspace,
  collapsePristineConversationDrafts,
  finishConversationRun,
  isPristineConversationDraft,
  isConversationRunning,
  removeConversationRun,
  startConversationRun,
  stopConversationWebSearch,
  stopPendingWebSearch,
  syncConversationUpdateIntoStreamingDrafts
} from './conversationRuntime.ts'
import type { Conversation } from '../../shared/types.ts'

test('keeps a draft workspace when changing model creates the first conversation', () => {
  const conversation: Conversation = {
    id: 'conversation-new',
    assistantId: 'assistant-a',
    title: 'new chat',
    messages: [],
    modelProviderId: 'provider-gllm',
    modelId: 'gpt-5.5',
    createdAt: 10,
    updatedAt: 10
  }
  const workspace = {
    rootPath: '/workspace/project',
    displayName: 'project',
    permission: 'read-write' as const,
    approvalMode: 'ask' as const,
    grantedAt: 11,
    lastVerifiedAt: 11
  }

  const materialized = attachDraftWorkspace(conversation, workspace)

  assert.equal(materialized.workspace, workspace)
  assert.equal(conversation.workspace, undefined)
})

test('collapses repeated untouched conversations but keeps the selected draft', () => {
  const createDraft = (id: string): Conversation => ({
    id,
    assistantId: 'assistant-a',
    title: 'Assistant A',
    messages: [],
    reasoningEffort: 'default',
    createdAt: 10,
    updatedAt: 10
  })
  const completed: Conversation = {
    ...createDraft('completed'),
    messages: [{ id: 'message-1', role: 'user', content: 'hello', createdAt: 11 }],
    updatedAt: 11
  }
  const drafts = [createDraft('draft-a'), createDraft('draft-b'), completed]

  assert.equal(isPristineConversationDraft(drafts[0]), true)
  assert.deepEqual(
    collapsePristineConversationDrafts(drafts, 'draft-b').map((conversation) => conversation.id),
    ['draft-b', 'completed']
  )
  assert.deepEqual(
    collapsePristineConversationDrafts(drafts, 'completed').map((conversation) => conversation.id),
    ['completed']
  )
})

test('does not collapse configured empty conversations', () => {
  const configured: Conversation = {
    id: 'configured',
    assistantId: 'assistant-a',
    title: 'Assistant A',
    messages: [],
    reasoningEffort: 'high',
    createdAt: 10,
    updatedAt: 20
  }

  assert.equal(isPristineConversationDraft(configured), false)
  assert.deepEqual(collapsePristineConversationDrafts([configured]), [configured])
})

test('stops an active web search without changing completed research', () => {
  const searching = {
    status: 'searching' as const,
    query: 'test',
    activeQueries: ['test'],
    results: []
  }
  const completed = { ...searching, status: 'completed' as const }

  assert.deepEqual(stopPendingWebSearch(searching), {
    ...searching,
    status: 'stopped',
    activeQueries: [],
    error: 'stopped'
  })
  assert.equal(stopPendingWebSearch(completed), completed)

  const conversation: Conversation = {
    id: 'conversation-searching',
    assistantId: 'assistant-a',
    title: 'Searching',
    messages: [{ id: 'message-searching', role: 'assistant', content: '', createdAt: 10, webSearch: searching }],
    createdAt: 10,
    updatedAt: 10
  }
  assert.equal(stopConversationWebSearch(conversation).messages[0].webSearch?.status, 'stopped')
})

test('does not replace an existing conversation workspace with stale draft state', () => {
  const existingWorkspace = {
    rootPath: '/workspace/existing',
    displayName: 'existing',
    permission: 'read-write' as const,
    grantedAt: 10,
    lastVerifiedAt: 10
  }
  const conversation: Conversation = {
    id: 'conversation-existing',
    assistantId: 'assistant-a',
    title: 'chat',
    messages: [],
    workspace: existingWorkspace,
    createdAt: 10,
    updatedAt: 10
  }
  const staleWorkspace = { ...existingWorkspace, rootPath: '/workspace/stale' }

  assert.equal(attachDraftWorkspace(conversation, staleWorkspace), conversation)
})

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
