/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { getExplicitResponseStyleInstruction, withPromptQualityWrapper } from './assistantPromptPolicy.ts'

test('honors concise and one-sentence response requests', () => {
  assert.match(getExplicitResponseStyleInstruction('用一句话介绍这个项目'), /只输出一个自然、完整的句子/)
  assert.match(getExplicitResponseStyleInstruction('以上太长了，帮我精简一下'), /直接给精简结果/)
  assert.equal(getExplicitResponseStyleInstruction('分析这个项目'), '')
})

test('replaces the legacy mandatory three-part wrapper', () => {
  const prompt = withPromptQualityWrapper('测试助手\n\n在输出时，请默认使用“结论 -> 依据 -> 下一步动作”结构；若信息不足请先澄清边界，不要编造事实。')
  assert.doesNotMatch(prompt, /默认使用“结论 -> 依据 -> 下一步动作”结构/)
  assert.match(prompt, /不要强行添加/)
})
