/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAssistantSkillContext, resolveAssistantSkills, resolveAssistantTools } from './assistantCapabilities.ts'
import type { Assistant, SkillConfig, ToolConfig } from './types.ts'

const assistant = { id: 'a', skillIds: ['s1', 's2'], toolIds: ['t1', 't2'] } as Assistant
const skill = (id: string, status: SkillConfig['status']): SkillConfig => ({
  id,
  name: id,
  description: '',
  instructions: `rules-${id}`,
  version: '1.2.3',
  status,
  sourceType: 'local',
  toolIds: [],
  createdAt: 1,
  updatedAt: 1
})
const tool = (id: string, enabled: boolean): ToolConfig => ({
  id,
  type: 'function',
  name: id,
  enabled,
  createdAt: 1,
  updatedAt: 1
})

test('resolves only active capabilities explicitly bound to the assistant', () => {
  assert.deepEqual(resolveAssistantSkills(assistant, [skill('s1', 'active'), skill('s2', 'paused'), skill('s3', 'active')]).map(({ id }) => id), ['s1'])
  assert.deepEqual(resolveAssistantTools(assistant, [tool('t1', true), tool('t2', false), tool('t3', true)]).map(({ id }) => id), ['t1'])
})

test('skill context includes versioned reusable instructions and excludes inactive skills', () => {
  const context = buildAssistantSkillContext([skill('s1', 'active'), skill('s2', 'draft')])
  assert.match(context, /s1 \(v1\.2\.3\)/)
  assert.match(context, /rules-s1/)
  assert.doesNotMatch(context, /rules-s2/)
})
