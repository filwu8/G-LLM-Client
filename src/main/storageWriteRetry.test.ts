/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { isTransientStoreWriteError, withStoreWriteRetry } from './storageWriteRetry.ts'

const eperm = () => Object.assign(new Error('operation not permitted'), { code: 'EPERM' })

test('recognizes transient Windows file-lock errors only', () => {
  assert.equal(isTransientStoreWriteError(eperm()), true)
  assert.equal(isTransientStoreWriteError(Object.assign(new Error('busy'), { code: 'EBUSY' })), true)
  assert.equal(isTransientStoreWriteError(Object.assign(new Error('denied'), { code: 'EACCES' })), true)
  assert.equal(isTransientStoreWriteError(Object.assign(new Error('no space'), { code: 'ENOSPC' })), false)
  assert.equal(isTransientStoreWriteError(new Error('plain')), false)
  assert.equal(isTransientStoreWriteError(undefined), false)
})

test('retries a transient lock and succeeds without replaying after success', () => {
  let attempts = 0
  const result = withStoreWriteRetry(() => {
    attempts++
    if (attempts < 3) throw eperm()
    return 'saved'
  }, [0, 0, 0, 0])
  assert.equal(result, 'saved')
  assert.equal(attempts, 3, 'stops as soon as the write succeeds')
})

test('propagates non-lock errors immediately without retrying', () => {
  let attempts = 0
  assert.throws(() => withStoreWriteRetry(() => {
    attempts++
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
  }, [0, 0, 0]), /disk full/)
  assert.equal(attempts, 1, 'a real error is not retried')
})

test('throws the last lock error after exhausting retries', () => {
  let attempts = 0
  assert.throws(() => withStoreWriteRetry(() => {
    attempts++
    throw eperm()
  }, [0, 0, 0]), (error) => (error as NodeJS.ErrnoException).code === 'EPERM')
  assert.equal(attempts, 3)
})
