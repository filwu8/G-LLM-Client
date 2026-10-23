/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { StorageTasks } from './storageTasks.ts'
import { ActiveResponseRegistry } from './activeResponse.ts'

test('stopping or replacing a response still blocks migration until actual cleanup finishes', () => {
  const responses = new ActiveResponseRegistry()
  const first = responses.register('workspace', 'conversation')
  responses.cancelConversation('conversation')
  assert.deepEqual(responses.activeConversationIds, ['conversation'])
  const replacement = responses.register('workspace', 'conversation')
  responses.release(replacement)
  assert.deepEqual(responses.activeConversationIds, ['conversation'])
  responses.release(first)
  assert.deepEqual(responses.activeConversationIds, [])
})
test('file jobs and failed diagnostics remain tracked until their promises settle', async () => {
  const tasks = new StorageTasks()
  let complete!: () => void
  const running = tasks.run(() => new Promise<void>(resolve => { complete = resolve }))
  assert.equal(tasks.count, 1)
  await assert.rejects(tasks.run(async () => { throw new Error('diagnostic failed') }), /diagnostic failed/)
  assert.equal(tasks.count, 1)
  complete()
  await running
  assert.equal(tasks.count, 0)
})
