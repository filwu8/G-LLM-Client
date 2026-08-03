/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { sortAssistantsForSidebar, sortConversationsForSidebar } from './sidebarOrdering.ts'

test('conversations keep pinned items first and sort the rest by recent activity', () => {
  const conversations = [
    { id: 'old', updatedAt: 10 },
    { id: 'new', updatedAt: 30 },
    { id: 'pinned-old', updatedAt: 5, pinnedAt: 100 },
    { id: 'pinned-new', updatedAt: 20, pinnedAt: 200 }
  ]

  assert.deepEqual(
    sortConversationsForSidebar(conversations).map((conversation) => conversation.id),
    ['pinned-new', 'pinned-old', 'new', 'old']
  )
})

test('assistants use their latest conversation while retaining stable no-conversation order', () => {
  const assistants = [
    { id: 'unused-first' },
    { id: 'recent' },
    { id: 'older' },
    { id: 'unused-second' },
    { id: 'pinned', pinnedAt: 100 }
  ]
  const conversations = [
    { assistantId: 'older', updatedAt: 20 },
    { assistantId: 'recent', updatedAt: 50 },
    { assistantId: 'older', updatedAt: 10 },
    { assistantId: 'pinned', updatedAt: 1 }
  ]

  assert.deepEqual(
    sortAssistantsForSidebar(assistants, conversations).map((assistant) => assistant.id),
    ['pinned', 'recent', 'older', 'unused-first', 'unused-second']
  )
})
