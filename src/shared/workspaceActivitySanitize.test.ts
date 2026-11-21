/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeWorkspaceActivity } from './workspaceActivitySanitize.ts'
import type { WorkspaceToolActivity } from './types'

const full: WorkspaceToolActivity = {
  id: 'step-1',
  tool: 'run_python',
  label: '跑迁移脚本',
  status: 'completed',
  detail: '跑完了',
  input: 'python scripts/migrate.py --dry-run',
  output: 'migrated 12 rows\n',
  startedAt: 1_000,
  endedAt: 2_000,
  files: ['scripts/migrate.py'],
  seat: '后端席位',
  seatAssistantId: 'seat-backend',
  seatConversationId: 'conv::seat-backend',
  steps: [{ id: 's1', title: '备份数据库', status: 'completed' }]
}

test('a saved step keeps its command, output and seat jump target', () => {
  const saved = sanitizeWorkspaceActivity(full, 5_000)
  assert.equal(saved.input, 'python scripts/migrate.py --dry-run')
  assert.equal(saved.output, 'migrated 12 rows\n')
  assert.equal(saved.detail, '跑完了')
  assert.equal(saved.seat, '后端席位')
  assert.equal(saved.seatAssistantId, 'seat-backend')
  assert.equal(saved.seatConversationId, 'conv::seat-backend')
  assert.deepEqual(saved.files, ['scripts/migrate.py'])
  assert.equal(saved.steps?.[0].title, '备份数据库')
  assert.equal(saved.startedAt, 1_000)
  assert.equal(saved.endedAt, 2_000)
})

test('it still normalises missing fields and caps runaway output', () => {
  const saved = sanitizeWorkspaceActivity({ id: '', tool: '', label: '', status: 'running', output: 'x'.repeat(30_000) } as WorkspaceToolActivity, 42)
  assert.equal(saved.id, 'activity_42')
  assert.equal(saved.label, '工作区操作')
  assert.equal(saved.status, 'running')
  assert.equal(saved.output?.length, 20_000)
  assert.equal(saved.input, undefined)
})

test('an unset seat target stays unset so the console renders no jump button', () => {
  const saved = sanitizeWorkspaceActivity({ ...full, seat: undefined, seatAssistantId: undefined, seatConversationId: undefined }, 1)
  assert.equal(saved.seat, undefined)
  assert.equal(saved.seatAssistantId, undefined)
  assert.equal(saved.seatConversationId, undefined)
})
