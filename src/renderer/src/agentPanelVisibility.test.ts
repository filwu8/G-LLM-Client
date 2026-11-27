/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldCollapseActivityPanelForQuestion } from './agentPanelVisibility.ts'

test('a new question collapses the activity panel once, on arrival', () => {
  // A question appears where none was waiting.
  assert.equal(shouldCollapseActivityPanelForQuestion(null, 'q-1'), true)
  // The same question re-rendering must not fight a user who reopened the panel.
  assert.equal(shouldCollapseActivityPanelForQuestion('q-1', 'q-1'), false)
  // A different question is a new interruption.
  assert.equal(shouldCollapseActivityPanelForQuestion('q-1', 'q-2'), true)
})

test('answering a question does not reopen or re-collapse anything', () => {
  assert.equal(shouldCollapseActivityPanelForQuestion('q-1', null), false)
  assert.equal(shouldCollapseActivityPanelForQuestion(null, null), false)
  assert.equal(shouldCollapseActivityPanelForQuestion(undefined, undefined), false)
  assert.equal(shouldCollapseActivityPanelForQuestion('q-1', '  '), false)
})
