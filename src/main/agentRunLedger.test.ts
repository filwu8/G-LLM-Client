/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { AgentRunLedger } from './agentRunLedger.ts'

function createLedger(t: TestContext): { directory: string; ledger: AgentRunLedger } {
  const directory = mkdtempSync(join(tmpdir(), 'gllm-agent-runs-'))
  // Without this every suite run leaves a directory behind: several hundred
  // had accumulated in the OS temp folder before anyone noticed, because a
  // leaked temp directory is invisible to a passing test.
  t.after(() => { rmSync(directory, { recursive: true, force: true }) })
  let now = 1_000
  return { directory, ledger: new AgentRunLedger(directory, () => now += 10) }
}

test('persists a typed agent run without request content or credentials', (t) => {
  const { directory, ledger } = createLedger(t)
  const run = ledger.start({
    kind: 'workspace',
    conversationId: 'conversation-a',
    providerId: 'official',
    modelId: 'gpt-test',
    details: { authorization: 'Bearer secret-token', messageCount: 4 }
  })
  ledger.record(run.id, 'model_request_started', 'running_model', { turn: 1 })
  ledger.record(run.id, 'run_succeeded', 'succeeded', { changedFiles: 2, totalTokens: 321 })

  const saved = new AgentRunLedger(directory).get(run.id)
  assert.equal(saved?.status, 'succeeded')
  assert.equal(saved?.changedFiles, 2)
  assert.equal(saved?.totalTokens, 321)

  const events = readFileSync(join(directory, 'agent-runs.jsonl'), 'utf8')
  assert.equal(events.includes('secret-token'), false)
  assert.match(events, /REDACTED/)
})

test('marks non-terminal runs interrupted after restart', (t) => {
  const { directory, ledger } = createLedger(t)
  const active = ledger.start({
    kind: 'chat',
    conversationId: 'conversation-active',
    providerId: 'provider',
    modelId: 'model'
  })
  ledger.record(active.id, 'model_request_started', 'running_model')
  const completed = ledger.start({
    kind: 'workspace',
    conversationId: 'conversation-complete',
    providerId: 'provider',
    modelId: 'model'
  })
  ledger.record(completed.id, 'run_succeeded', 'succeeded')

  const restarted = new AgentRunLedger(directory)
  const recovered = restarted.recoverInterruptedRuns()
  assert.deepEqual(recovered.map((run) => run.id), [active.id])
  assert.equal(restarted.get(active.id)?.status, 'interrupted')
  assert.equal(restarted.get(completed.id)?.status, 'succeeded')
})

test('does not reopen a terminal run', (t) => {
  const { ledger } = createLedger(t)
  const run = ledger.start({
    kind: 'workspace',
    conversationId: 'conversation-a',
    providerId: 'provider',
    modelId: 'model'
  })
  ledger.record(run.id, 'run_stopped', 'stopped')
  const unchanged = ledger.record(run.id, 'tool_started', 'running_tool')
  assert.equal(unchanged.status, 'stopped')
  assert.equal(unchanged.eventCount, 2)
})

test('keeps an older active task while newer finished runs roll out of the log', (t) => {
  const { directory, ledger } = createLedger(t)
  const task = { kind: 'workspace' as const, conversationId: 'long-task', providerId: 'provider', modelId: 'model' }
  const active = ledger.start(task)
  for (let index = 0; index < 100; index += 1) {
    const other = ledger.start({ ...task, conversationId: `short-${index}` })
    ledger.record(other.id, 'run_succeeded', 'succeeded')
  }
  assert.equal(new AgentRunLedger(directory).get(active.id)?.status, 'queued')
  assert.equal(ledger.record(active.id, 'tool_started', 'running_tool').status, 'running_tool')
})
