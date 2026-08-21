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
  startConversationRun
} from './conversationRuntime.ts'

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
