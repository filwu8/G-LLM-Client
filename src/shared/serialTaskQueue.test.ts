/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createSerialTaskQueue } from './serialTaskQueue.ts'

test('serial task queue preserves order when different exports overlap', async () => {
  const enqueue = createSerialTaskQueue()
  const events: string[] = []
  let releaseFirst: (() => void) | undefined

  const first = enqueue(async () => {
    events.push('first-start')
    await new Promise<void>((resolve) => { releaseFirst = resolve })
    events.push('first-end')
    return 'first'
  })
  const second = enqueue(async () => {
    events.push('second-start')
    events.push('second-end')
    return 'second'
  })

  await Promise.resolve()
  assert.deepEqual(events, ['first-start'])
  releaseFirst?.()

  assert.deepEqual(await Promise.all([first, second]), ['first', 'second'])
  assert.deepEqual(events, ['first-start', 'first-end', 'second-start', 'second-end'])
})

test('serial task queue continues after an export fails', async () => {
  const enqueue = createSerialTaskQueue()
  const events: string[] = []

  const failed = enqueue(async () => {
    events.push('first')
    throw new Error('capture failed')
  })
  const next = enqueue(async () => {
    events.push('second')
    return 'copied'
  })

  await assert.rejects(failed, /capture failed/)
  assert.equal(await next, 'copied')
  assert.deepEqual(events, ['first', 'second'])
})
