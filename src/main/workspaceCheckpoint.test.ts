/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceCheckpointStore, workspaceTaskId, type WorkspaceCheckpoint } from './workspaceCheckpoint.ts'

const checkpoint = (taskId: string): WorkspaceCheckpoint => ({
  version: 1, taskId, root: 'C:\\workspace', turns: 3,
  activities: [], changedFiles: [], evidence: [], stalledTurns: 0, hasExecutionEvidence: false
})

test('checkpoint save/load round-trips and filters by task id and root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gllm-checkpoint-test-'))
  try {
    const store = new WorkspaceCheckpointStore(dir, 'conv-1')
    const taskId = workspaceTaskId('msg-1')
    store.save(checkpoint(taskId))
    assert.deepEqual(store.load(taskId, 'C:\\workspace'), checkpoint(taskId))
    assert.equal(store.load('message:other', 'C:\\workspace'), undefined)
    assert.equal(store.load(taskId, 'D:\\other'), undefined)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('repeated saves overwrite cleanly without leaving temp files (retry-safe write)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gllm-checkpoint-repeat-'))
  try {
    const store = new WorkspaceCheckpointStore(dir, 'conv-2')
    const taskId = workspaceTaskId('msg-2')
    for (let turn = 0; turn < 8; turn++) {
      store.save({ ...checkpoint(taskId), turns: turn })
      assert.equal(store.load(taskId, 'C:\\workspace')?.turns, turn)
    }
    const dir2 = join(dir, 'workspace-checkpoints')
    const leftovers = readdirSync(dir2).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [], 'no temporary files are left behind')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
