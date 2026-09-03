/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveGoalContextMode, selectGoalContextMessages } from './goalContext.ts'
import type { ChatMessage, GoalTask } from './types.ts'

const message = (id: string, content: string): ChatMessage => ({ id, role: 'user', content, createdAt: 1 })

test('auto context continues a related goal and isolates an unrelated goal', () => {
  const previous = { goal: '开发用户登录页面', acceptanceCriteria: '登录页面可以正常构建' }
  assert.equal(resolveGoalContextMode('auto', '继续完善登录页面样式', '登录页面适配手机', previous, []), 'continue')
  assert.equal(resolveGoalContextMode('auto', '制作一份北海道旅游计划', '包含酒店和交通', previous, []), 'isolated')
})

test('isolated goal only sends messages from its context boundary', () => {
  const messages = [message('old', '旧任务'), message('goal', '新目标'), message('reply', '继续执行')]
  const task = {
    contextStartMessageId: 'goal',
    resolvedContextMode: 'isolated'
  } as GoalTask
  assert.deepEqual(selectGoalContextMessages(messages, task).map((item) => item.id), ['goal', 'reply'])
})

test('relevant mode keeps matching history without deleting the current goal messages', () => {
  const messages = [
    message('login', '登录页面需要支持手机布局'),
    message('noise', '北海道酒店预订'),
    message('goal', '优化登录页面手机布局')
  ]
  const task = {
    goal: '优化登录页面手机布局',
    acceptanceCriteria: '登录页面适配手机',
    contextStartMessageId: 'goal',
    resolvedContextMode: 'relevant'
  } as GoalTask
  assert.deepEqual(selectGoalContextMessages(messages, task).map((item) => item.id), ['login', 'goal'])
})
