/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { replaceUserMessageBranch } from './conversationEditing.ts'
import type { ChatMessage, Conversation } from '../../shared/types.ts'

const firstUserMessage: ChatMessage = {
  id: 'user-1',
  role: 'user',
  content: 'first question',
  createdAt: 1
}
const assistantMessage: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  content: 'first answer',
  createdAt: 2
}
const secondUserMessage: ChatMessage = {
  id: 'user-2',
  role: 'user',
  content: 'second question',
  createdAt: 3
}
const conversation: Conversation = {
  id: 'conversation-1',
  assistantId: 'assistant-a',
  title: 'test',
  messages: [firstUserMessage, assistantMessage, secondUserMessage],
  createdAt: 1,
  updatedAt: 3
}

test('replaces the selected user message and removes its old reply branch', () => {
  const attachment = {
    id: 'attachment-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: 10,
    kind: 'file' as const
  }
  const editedMessage: ChatMessage = {
    id: 'user-edited',
    role: 'user',
    content: '  revised first question  ',
    attachments: [attachment],
    createdAt: 4
  }

  const result = replaceUserMessageBranch(conversation, firstUserMessage.id, editedMessage)

  assert.deepEqual(result?.messages, [{ ...editedMessage, content: 'revised first question' }])
  assert.equal(result?.messages[0].attachments?.[0], attachment)
})

test('keeps earlier context when editing a later user message', () => {
  const editedMessage: ChatMessage = {
    id: 'user-edited',
    role: 'user',
    content: 'revised second question',
    createdAt: 4
  }

  const result = replaceUserMessageBranch(conversation, secondUserMessage.id, editedMessage)

  assert.deepEqual(result?.messages, [firstUserMessage, assistantMessage, editedMessage])
})

test('rejects empty edits and non-user targets', () => {
  const emptyEdit: ChatMessage = {
    id: 'user-edited',
    role: 'user',
    content: '   ',
    createdAt: 4
  }
  const validEdit = { ...emptyEdit, content: 'valid' }

  assert.equal(replaceUserMessageBranch(conversation, firstUserMessage.id, emptyEdit), null)
  assert.equal(replaceUserMessageBranch(conversation, assistantMessage.id, validEdit), null)
  assert.equal(replaceUserMessageBranch(conversation, 'missing', validEdit), null)
})

test('drops project memory when the edited branch contributed to it', () => {
  const projectMemory = {
    overview: 'derived from the old branch',
    requirements: [],
    decisions: [],
    businessRules: [],
    entities: [],
    openItems: [],
    risks: [],
    updatedAt: 4,
    sourceMessageCount: 3
  }
  const result = replaceUserMessageBranch(
    { ...conversation, projectMemory },
    secondUserMessage.id,
    { ...secondUserMessage, id: 'user-edited', content: 'revised' }
  )

  assert.equal(result?.projectMemory, undefined)
})

test('keeps project memory derived only from context before the edited message', () => {
  const projectMemory = {
    overview: 'earlier stable context',
    requirements: [],
    decisions: [],
    businessRules: [],
    entities: [],
    openItems: [],
    risks: [],
    updatedAt: 2,
    sourceMessageCount: 2
  }
  const result = replaceUserMessageBranch(
    { ...conversation, projectMemory },
    secondUserMessage.id,
    { ...secondUserMessage, id: 'user-edited', content: 'revised' }
  )

  assert.equal(result?.projectMemory, projectMemory)
})
