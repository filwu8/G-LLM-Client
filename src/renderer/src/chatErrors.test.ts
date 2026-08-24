/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyChatError } from './chatErrorPolicy.ts'

test('hides upstream JSON for parenthesized 500 errors and recommends another model', () => {
  const classification = classifyChatError(
    '模型请求阶段失败：模型服务发生临时故障（500）：{"error":{"message":"upstream error: do request failed (request id: 20260824012229535520637fac3fbf8gMi4hU90)"}}'
  )

  assert.equal(classification.messageKey, 'errors.modelUnavailable')
  assert.equal(classification.status, 500)
  assert.equal(classification.automaticallyRetryable, true)
})

test('treats an upstream routing failure without a status as retryable', () => {
  const classification = classifyChatError('upstream error: do_request_failed')

  assert.equal(classification.automaticallyRetryable, true)
  assert.equal(classification.messageKey, 'errors.modelUnavailable')
})

test('keeps non-service workspace errors actionable', () => {
  const classification = classifyChatError('路径超出当前会话工作区')

  assert.equal(classification.automaticallyRetryable, false)
  assert.equal(classification.messageKey, undefined)
  assert.equal(classification.raw, '路径超出当前会话工作区')
})
