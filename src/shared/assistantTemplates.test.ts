/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { createAssistantTemplateBundle, importAssistantTemplateBundle } from './assistantTemplates.ts'
import type { Assistant, SkillConfig, ToolConfig } from './types.ts'

const assistant = { id: 'a', name: 'A', title: 'A', tone: '', color: 'ink', icon: 'sparkles', systemPrompt: 'rules', starterPrompts: [], skillIds: ['s'], toolIds: ['t'], delegateAssistantIds: ['secret'] } as Assistant
const skill = { id: 's', name: 'S', description: '', instructions: 'skill', version: '1.0.0', status: 'active', sourceType: 'local', toolIds: ['t'], createdAt: 1, updatedAt: 1 } as SkillConfig
const tool = { id: 't', name: 'T', type: 'mcp', endpoint: 'secret-command', enabled: true, createdAt: 1, updatedAt: 1 } as ToolConfig

test('export includes bound capabilities but strips endpoints and delegation edges', () => {
  const bundle = createAssistantTemplateBundle(assistant, [skill], [tool], 'Team', 10)
  assert.equal(bundle.tools[0].endpoint, undefined)
  assert.equal(bundle.tools[0].enabled, false)
  assert.deepEqual(bundle.assistant.delegateAssistantIds, [])
})

test('import remaps every id, creates a draft, and preserves safe bindings', () => {
  let sequence = 0
  const bundle = createAssistantTemplateBundle(assistant, [skill], [tool], 'Team', 10)
  const imported = importAssistantTemplateBundle(bundle, 'project', (prefix) => `${prefix}_${++sequence}`, 20)
  assert.equal(imported.assistant.status, 'draft')
  assert.equal(imported.assistant.projectId, 'project')
  assert.deepEqual(imported.assistant.skillIds, [imported.skills[0].id])
  assert.deepEqual(imported.skills[0].toolIds, [imported.tools[0].id])
  assert.equal(imported.tools[0].endpoint, undefined)
  assert.ok(imported.warnings.length > 0)
})
