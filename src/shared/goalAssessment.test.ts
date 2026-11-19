/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fallbackGoalAssessment,
  sanitizeGoalAssessment,
  GOAL_CLARIFY_LIMIT,
  GOAL_MAX_QUESTIONS
} from './goalAssessment.ts'
import type { GoalAssessRequest } from './types.ts'

const request = (overrides: Partial<GoalAssessRequest> = {}): GoalAssessRequest => ({
  provider: {} as GoalAssessRequest['provider'],
  settings: {} as GoalAssessRequest['settings'],
  messages: [],
  latestInput: '帮我把这个项目构建通过',
  round: 0,
  language: 'zh-CN',
  ...overrides
})

test('sanitizeGoalAssessment keeps a sufficient judgment and its refined goal', () => {
  const result = sanitizeGoalAssessment({
    sufficient: true,
    goal: '  让项目通过构建  ',
    acceptanceCriteria: 'npm run build 成功',
    scope: '当前工作区',
    constraints: '',
    questions: ['ignored'],
    assumptions: ['范围=当前工作区'],
    changed: false
  }, request())

  assert.equal(result.sufficient, true)
  assert.equal(result.goal, '让项目通过构建')
  assert.equal(result.acceptanceCriteria, 'npm run build 成功')
  assert.equal(result.scope, '当前工作区')
  assert.equal(result.constraints, undefined)
  assert.deepEqual(result.questions, [], 'sufficient results never carry questions')
  assert.deepEqual(result.assumptions, ['范围=当前工作区'])
})

test('sanitizeGoalAssessment caps clarifying questions and tolerates malformed values', () => {
  const result = sanitizeGoalAssessment({
    sufficient: false,
    goal: '',
    acceptanceCriteria: 42,
    questions: ['q1', 'q2', 'q3', 'q4', '', 9],
    assumptions: 'not-an-array',
    changed: 'yes'
  }, request())

  assert.equal(result.sufficient, false)
  assert.equal(result.goal, '帮我把这个项目构建通过', 'empty goal falls back to the raw input')
  assert.equal(result.acceptanceCriteria, '')
  assert.equal(result.questions.length, GOAL_MAX_QUESTIONS)
  assert.deepEqual(result.questions, ['q1', 'q2', 'q3'])
  assert.deepEqual(result.assumptions, [])
  assert.equal(result.changed, false, 'non-boolean changed is normalized to false')
})

test('sanitizeGoalAssessment forces sufficient at the clarification ceiling', () => {
  const result = sanitizeGoalAssessment({
    sufficient: false,
    goal: '模糊目标',
    questions: ['还是会问什么'],
    assumptions: ['假设一']
  }, request({ round: GOAL_CLARIFY_LIMIT }))

  assert.equal(result.sufficient, true)
  assert.deepEqual(result.questions, [], 'no more questions once the limit is reached')
  assert.deepEqual(result.assumptions, ['假设一'])
})

test('fallbackGoalAssessment launches from the raw request and records the error', () => {
  const result = fallbackGoalAssessment(request({ latestInput: '  直接开始  ' }), 'timeout')
  assert.equal(result.sufficient, true)
  assert.equal(result.goal, '直接开始')
  assert.equal(result.error, 'timeout')
  assert.deepEqual(result.questions, [])
})

test('fallbackGoalAssessment without an error omits the error field', () => {
  const result = fallbackGoalAssessment(request())
  assert.equal('error' in result, false)
})

test('sanitizeGoalAssessment never surfaces permission / authorization questions', () => {
  const result = sanitizeGoalAssessment({
    sufficient: false,
    goal: '同步 git 并改进代码',
    questions: ['是否授权 git 操作？', '请选择工作区文件夹', '你希望改哪部分代码？']
  }, request())

  assert.equal(result.sufficient, false)
  assert.deepEqual(result.questions, ['你希望改哪部分代码？'], 'approval questions are dropped')
})

test('sanitizeGoalAssessment drops questions already asked in earlier rounds', () => {
  const result = sanitizeGoalAssessment({
    sufficient: false,
    goal: '改进代码',
    questions: ['你希望改哪部分代码？', '需要保留现有接口吗？']
  }, request({ alreadyAsked: ['你希望改哪部分代码？'] }))

  assert.deepEqual(result.questions, ['需要保留现有接口吗？'], 'duplicate question is removed')
})

test('sanitizeGoalAssessment treats a fully-deduplicated round as sufficient', () => {
  const result = sanitizeGoalAssessment({
    sufficient: false,
    goal: '改进代码',
    questions: ['你希望改哪部分代码？']
  }, request({ alreadyAsked: ['你希望改哪部分代码？'], round: 1 }))

  assert.equal(result.sufficient, true, 'nothing left to ask → launch from what we have')
  assert.deepEqual(result.questions, [])
})

test('sanitizeGoalAssessment parses choice questions and drops invalid options', () => {
  const result = sanitizeGoalAssessment({
    sufficient: false,
    goal: '选择技术栈',
    questions: [],
    choices: [
      { text: '用哪个技术栈？', options: ['React', 'Vue', 'React', ''], allowsCustom: true },
      { text: '只有一个选项', options: ['唯一'] },
      { text: '是否授权 git？', options: ['是', '否'] }
    ]
  }, request())

  assert.equal(result.sufficient, false)
  assert.equal(result.choices?.length, 1, 'invalid/approval choices are dropped')
  assert.deepEqual(result.choices?.[0].options, ['React', 'Vue'], 'duplicate/empty options removed')
  assert.equal(result.choices?.[0].allowsCustom, true)
})

test('sanitizeGoalAssessment does not repeat a choice question already asked', () => {
  const result = sanitizeGoalAssessment({
    sufficient: false,
    goal: '选择技术栈',
    questions: [],
    choices: [{ text: '用哪个技术栈？', options: ['React', 'Vue'] }]
  }, request({ alreadyAsked: ['用哪个技术栈？'] }))

  assert.equal(result.choices?.length, 0)
  assert.equal(result.sufficient, true, 'only remaining choice was a repeat → launch')
})
