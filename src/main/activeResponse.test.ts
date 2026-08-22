/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ActiveResponseRegistry } from './activeResponse.ts'

test('a replacement request makes the previous completion stale', () => {
  const registry = new ActiveResponseRegistry()
  const previous = registry.register('workspace', 'conversation-a')
  const replacement = registry.register('workspace', 'conversation-a')

  assert.equal(previous.controller.signal.aborted, true)
  assert.equal(registry.isCurrent(previous), false)
  assert.equal(registry.isCurrent(replacement), true)

  registry.release(previous)
  assert.equal(registry.isCurrent(replacement), true)
})

test('an explicit stop keeps the request current until its completion is published', () => {
  const registry = new ActiveResponseRegistry()
  const active = registry.register('workspace', 'conversation-a')

  registry.cancelConversation('conversation-a')

  assert.equal(active.controller.signal.aborted, true)
  assert.equal(registry.isCurrent(active), true)
  registry.release(active)
  assert.equal(registry.isCurrent(active), false)
})

test('different response purposes do not cancel one another', () => {
  const registry = new ActiveResponseRegistry()
  const reply = registry.register('chat', 'conversation-a', 'reply:main')
  const translation = registry.register('chat', 'conversation-a', 'translation:message-1')

  assert.equal(reply.controller.signal.aborted, false)
  assert.equal(translation.controller.signal.aborted, false)
})
