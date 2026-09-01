/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authorizeAssistantDelegation,
  filterAvailableAssistantDelegations,
  removeAssistantDelegationReferences
} from './assistantDelegation.ts'
import type { Assistant } from './types.ts'

const assistant = (id: string, delegates: string[] = []): Assistant => ({
  id, name: id, title: id, tone: '', color: 'ink', icon: 'sparkles', systemPrompt: id,
  starterPrompts: [], status: 'active', delegateAssistantIds: delegates
})

test('delegation requires an explicit edge and returns a bounded child context', () => {
  const source = assistant('source', ['target'])
  const result = authorizeAssistantDelegation(source, 'target', [source, assistant('target')])
  assert.equal(result.target.id, 'target')
  assert.deepEqual(result.nextContext.path, ['source', 'target'])
  assert.equal(result.nextContext.remainingCalls, 3)
})

test('delegation rejects unapproved, cyclic, exhausted, and too-deep calls', () => {
  const source = assistant('source', ['target'])
  const target = assistant('target')
  assert.throws(() => authorizeAssistantDelegation(source, 'other', [source, target]), /未获授权/)
  assert.throws(() => authorizeAssistantDelegation(source, 'target', [source, target], { path: ['source', 'target'], depth: 1, maxDepth: 2, remainingCalls: 2 }), /循环/)
  assert.throws(() => authorizeAssistantDelegation(source, 'target', [source, target], { path: ['source'], depth: 0, maxDepth: 2, remainingCalls: 0 }), /次数上限/)
  assert.throws(() => authorizeAssistantDelegation(source, 'target', [source, target], { path: ['source'], depth: 2, maxDepth: 2, remainingCalls: 2 }), /最大调用深度/)
})

test('deleting an assistant removes same-workspace delegation references without touching other workspaces', () => {
  const source = { ...assistant('source', ['target', 'other']), projectId: 'workspace-a' }
  const target = { ...assistant('target'), projectId: 'workspace-a' }
  const otherWorkspace = { ...assistant('remote', ['target']), projectId: 'workspace-b' }
  const result = removeAssistantDelegationReferences([source, target, otherWorkspace], 'target', 'workspace-a')

  assert.deepEqual(result.map((item) => item.id), ['source', 'remote'])
  assert.deepEqual(result[0].delegateAssistantIds, ['other'])
  assert.deepEqual(result[1].delegateAssistantIds, ['target'])
})

test('loading assistants filters missing and self-referencing delegation ids', () => {
  const result = filterAvailableAssistantDelegations([
    assistant('source', ['source', 'target', 'missing']),
    assistant('target')
  ])
  assert.deepEqual(result[0].delegateAssistantIds, ['target'])
})
