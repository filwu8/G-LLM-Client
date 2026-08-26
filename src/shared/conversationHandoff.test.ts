/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMainConversationOpenRequest,
  findMainConversationTarget,
  normalizeMainConversationOpenRequest
} from './conversationHandoff.ts'
import type { Conversation } from './types.ts'

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-a',
    projectId: 'project-a',
    assistantId: 'assistant-a',
    title: 'Conversation',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

test('creates a main-window target from the exact quick conversation', () => {
  assert.deepEqual(createMainConversationOpenRequest(conversation()), {
    conversationId: 'conversation-a',
    projectId: 'project-a',
    assistantId: 'assistant-a'
  })
})

test('validates and normalizes renderer handoff requests', () => {
  assert.deepEqual(normalizeMainConversationOpenRequest({
    conversationId: ' conversation-a ',
    projectId: ' project-a ',
    assistantId: ' assistant-a '
  }), {
    conversationId: 'conversation-a',
    projectId: 'project-a',
    assistantId: 'assistant-a'
  })
  assert.equal(normalizeMainConversationOpenRequest({ projectId: 'project-a' }), null)
  assert.equal(normalizeMainConversationOpenRequest('conversation-a'), null)
})

test('does not open a same-id conversation from a different project or assistant', () => {
  const target = conversation()
  assert.equal(findMainConversationTarget([target], createMainConversationOpenRequest(target)), target)
  assert.equal(findMainConversationTarget([target], {
    conversationId: target.id,
    projectId: 'project-b',
    assistantId: target.assistantId
  }), null)
})
