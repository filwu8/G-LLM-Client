/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { addSkillEvalCase, evaluateSkillRegression, evolveSkill, rollbackSkill } from './skillLifecycle.ts'
import type { SkillConfig } from './types.ts'

const base: SkillConfig = {
  id: 'skill', name: 'Review', description: 'Review work', instructions: 'old rules', version: '1.0.0',
  status: 'active', sourceType: 'local', toolIds: [], createdAt: 1, updatedAt: 1
}

test('skill evolution creates a revision and rollback creates a new version without erasing history', () => {
  const evolved = evolveSkill(base, 'new rules', 'feedback', 10)
  assert.equal(evolved.version, '1.0.1')
  assert.equal(evolved.revisions?.[0].instructions, 'old rules')
  const rolledBack = rollbackSkill(evolved, '1.0.0', 20)
  assert.equal(rolledBack.version, '1.0.2')
  assert.equal(rolledBack.instructions, 'old rules')
  assert.equal(rolledBack.revisions?.length, 2)
})

test('feedback cases produce repeatable pass and failure evidence', () => {
  let skill = addSkillEvalCase(base, 'review this', ['risk', 'action'], 'Risk found; action proposed.', 10)
  skill = addSkillEvalCase(skill, 'review that', ['risk', 'owner'], 'Risk found.', 11)
  const evaluated = evaluateSkillRegression(skill, 20)
  assert.deepEqual(evaluated.lastEvaluation, { skillVersion: '1.0.0', passed: 1, failed: 1, total: 2, evaluatedAt: 20 })
  assert.deepEqual(evaluated.evalCases?.[1].lastMissingCriteria, ['owner'])
})
