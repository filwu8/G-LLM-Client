/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSkillMarkdown } from './skillMarkdown.ts'

test('parses common SKILL.md frontmatter and keeps the markdown instructions', () => {
  const result = parseSkillMarkdown('---\nname: Code Review\ndescription: Review changes safely\n---\n# Workflow\n\n1. Inspect changes\n2. Run tests', 'SKILL.md')
  assert.equal(result.name, 'Code Review')
  assert.equal(result.description, 'Review changes safely')
  assert.equal(result.instructions, '# Workflow\n\n1. Inspect changes\n2. Run tests')
})

test('uses the first heading and paragraph when frontmatter is absent', () => {
  const result = parseSkillMarkdown('# Customer Support\n\nHandle customer requests consistently.\n\n## Rules\nBe concise.', 'support.md')
  assert.equal(result.name, 'Customer Support')
  assert.equal(result.description, 'Handle customer requests consistently.')
})
