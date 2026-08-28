/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getReasoningLengthRecoveryPrompt,
  getWorkspaceMaxTokenOption,
  isReasoningOnlyLengthOutcome,
  isWorkspaceActionRequest
} from './workspaceRequestPolicy.ts'

test('recognizes Chinese development and packaging requests as workspace actions', () => {
  assert.equal(isWorkspaceActionRequest('我需要你直接帮我开发，然后做成可执行的程序'), true)
  assert.equal(isWorkspaceActionRequest('构建并打包这个项目'), true)
  assert.equal(isWorkspaceActionRequest('解释一下这个目录的用途'), false)
})

test('detects output budget exhaustion that contains reasoning only', () => {
  assert.equal(isReasoningOnlyLengthOutcome({
    content: null,
    toolCallCount: 0,
    reasoningCharacters: 15_439,
    finishReason: 'length'
  }), true)
  assert.equal(isReasoningOnlyLengthOutcome({
    content: 'finished',
    toolCallCount: 0,
    reasoningCharacters: 15_439,
    finishReason: 'length'
  }), false)
  assert.equal(isReasoningOnlyLengthOutcome({
    content: null,
    toolCallCount: 1,
    reasoningCharacters: 15_439,
    finishReason: 'length'
  }), false)
})

test('uses the Qwen no-think recovery hint for an action request', () => {
  const prompt = getReasoningLengthRecoveryPrompt('Qwen3.6-35B-A3B-NVFP4', true)
  assert.match(prompt, /^\/no_think/)
  assert.match(prompt, /立即调用/)
})

test('lets the upstream model choose its output budget unless the user enables a limit', () => {
  assert.deepEqual(getWorkspaceMaxTokenOption({ enableMaxTokens: false, maxTokens: 4096 }), {})
  assert.deepEqual(getWorkspaceMaxTokenOption({ enableMaxTokens: true, maxTokens: 16_384 }), { max_tokens: 16_384 })
})
