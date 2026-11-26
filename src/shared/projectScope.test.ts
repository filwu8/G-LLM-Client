/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { belongsToProject, withoutProjectKeys, withoutProjectRecords } from './projectScope.ts'

test('a record without a project id belongs to the default project', () => {
  assert.equal(belongsToProject(undefined, 'project_default'), true)
  assert.equal(belongsToProject('   ', 'project_default'), true)
  assert.equal(belongsToProject(undefined, 'project_custom'), false, 'bounding ids to the default project must not leak into every delete')
  assert.equal(belongsToProject('project_custom', 'project_custom'), true)
})

test('deleting a project drops its records and keeps the others', () => {
  // Deleting a project used to remove only the project row: its conversations
  // stayed on disk, unreachable from the UI and rewritten on every save.
  const records = [
    { id: 'c1', projectId: 'project_scratch' },
    { id: 'c2', projectId: 'project_other' },
    { id: 'c3' },
    { id: 'c4', projectId: 'project_default' }
  ]
  assert.deepEqual(
    withoutProjectRecords(records, 'project_scratch').map((record) => record.id),
    ['c2', 'c3', 'c4']
  )
  assert.deepEqual(
    withoutProjectRecords(records, 'project_default').map((record) => record.id),
    ['c1', 'c2'],
    'records with no project id are the default project, so deleting the default project takes them too'
  )
})

test('keyed project state is purged by project, not by substring', () => {
  const keys = [
    'project_scratch:assistant_a',
    'project_scratch_2:assistant_a',
    'project_default:assistant_a'
  ]
  assert.deepEqual(
    withoutProjectKeys(keys, 'project_scratch'),
    ['project_scratch_2:assistant_a', 'project_default:assistant_a'],
    'only the exact project prefix is removed'
  )
})
