/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getReasoningLengthRecoveryPrompt,
  getWorkspaceFileFailureMessage,
  getWorkspaceMaxTokenOption,
  isImageGenerationRequest,
  isReasoningOnlyLengthOutcome,
  isWorkspaceActionRequest
} from './workspaceRequestPolicy.ts'

test('recognizes Chinese development and packaging requests as workspace actions', () => {
  assert.equal(isWorkspaceActionRequest('我需要你直接帮我开发，然后做成可执行的程序'), true)
  assert.equal(isWorkspaceActionRequest('构建并打包这个项目'), true)
  assert.equal(isWorkspaceActionRequest('解释一下这个目录的用途'), false)
})

test('distinguishes the reported ERP onboarding question from the actual template creation request', () => {
  assert.equal(isWorkspaceActionRequest('我想让你帮我操作ERP，我需要做一些什么'), false)
  assert.equal(isWorkspaceActionRequest('你帮我创建一个 .env，然后我会自己填写进去'), true)
})

test('an incomplete file operation reports the tool error rather than blaming the model', () => {
  const message = getWorkspaceFileFailureMessage('File operation incomplete.', [
    { tool: 'read_file', status: 'completed', detail: 'Template read' },
    { tool: 'write_file', status: 'failed', detail: '.env already exists; it was not overwritten' }
  ])
  assert.match(message, /write_file: .env already exists/)
  assert.doesNotMatch(message, /Switch models/)
  assert.equal(getWorkspaceFileFailureMessage('File operation incomplete.', []), 'File operation incomplete.')
})

test('recognizes image generation requests without confusing other generated artifacts', () => {
  assert.equal(isImageGenerationRequest('帮我生成一张赛博朋克城市图片'), true)
  assert.equal(isImageGenerationRequest('帮我画一只戴礼帽的猫'), true)
  assert.equal(isImageGenerationRequest('Design a poster for the product launch'), true)
  assert.equal(isImageGenerationRequest('生成一份季度报告'), false)
  assert.equal(isImageGenerationRequest('分析这张图片'), false)
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
