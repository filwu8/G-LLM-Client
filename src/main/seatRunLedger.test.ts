/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { AgentRunLedger } from './agentRunLedger.ts'
import { shouldBookParentRun } from './seatProgressForward.ts'
import type { WorkspaceAgentProgress, WorkspaceToolActivity } from '../shared/types.ts'

const PARENT = 'conv-console'
const SEAT = 'conv-console::seat-reviewer'

function readEvents(directory: string) {
  return readFileSync(join(directory, 'agent-runs.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
}

/**
 * End-to-end check on a real ledger file: one dispatch that takes many seat steps
 * must still book exactly one `delegate_assistant` call, and the seat's own steps
 * must be booked under the seat's conversation id.
 */
test('one dispatch books one delegate_assistant call however many steps the seat takes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gllm-seat-runs-'))
  let now = 1_000
  const ledger = new AgentRunLedger(directory, () => (now += 10))
  const run = ledger.start({
    kind: 'workspace',
    conversationId: PARENT,
    providerId: 'official',
    modelId: 'gpt-test',
    details: { delegatedFromAssistant: 'assistant-console', delegatedFromConversation: PARENT }
  })

  // The console books its own dispatch once.
  ledger.record(run.id, 'tool_started', 'running_tool', { tool: 'delegate_assistant', label: '调用协作助手' })

  const summaryEntry: WorkspaceToolActivity = {
    id: 'delegate-1',
    tool: 'delegate_assistant',
    label: '调用协作助手',
    status: 'running',
    detail: ''
  }
  const seatSteps = ['read_file', 'search_text', 'edit_file', 'run_python', 'read_file']
  const forwarded: WorkspaceAgentProgress[] = []
  for (const [index, tool] of seatSteps.entries()) {
    // What the seat itself produces: its own conversation id, its own tool call.
    forwarded.push({ conversationId: SEAT, activity: { id: `step-${index}`, tool, label: tool, status: 'completed', detail: tool } })
    // What the console receives: one reused summary line carrying the step counter.
    forwarded.push({
      conversationId: PARENT,
      activity: { ...summaryEntry, delegatedStep: true, detail: `第 ${index + 1} 步 · ${tool}` }
    })
  }

  for (const progress of forwarded) {
    if (!shouldBookParentRun(progress, PARENT)) continue
    ledger.record(run.id, 'tool_started', 'running_tool', { tool: progress.activity.tool, label: progress.activity.label })
  }
  ledger.record(run.id, 'tool_completed', 'succeeded', { tool: 'delegate_assistant' })
  ledger.record(run.id, 'run_succeeded', 'succeeded', { changedFiles: 1 })

  const events = readEvents(directory)
  const delegateStarts = events.filter(event => event.type === 'tool_started' && event.details?.tool === 'delegate_assistant')
  assert.equal(delegateStarts.length, 1, 'one dispatch must produce exactly one booked call')
  assert.equal(events.filter(event => event.type === 'tool_started').length, 1, 'no seat step may be booked on the console run')
  assert.equal(events.filter(event => event.type === 'tool_completed').length, 1)

  // The seat's own steps never reach the console file: they carry the seat's conversation id
  // and are booked on the seat's own run, which is created by executeAssistantDelegation.
  assert.equal(events.some(event => event.conversationId === SEAT), false)
})

test('the same forwarded stream still reaches the seat, so nothing is lost by the filter', () => {
  const steps: WorkspaceAgentProgress[] = [
    { conversationId: SEAT, activity: { id: 's1', tool: 'read_file', label: '读文件', status: 'completed', detail: '' } },
    { conversationId: SEAT, activity: { id: 's2', tool: 'edit_file', label: '改文件', status: 'completed', detail: '' } }
  ]
  // The seat conversation keeps every step: only the console skips them.
  assert.equal(steps.filter(progress => progress.conversationId === SEAT).length, 2)
  assert.equal(steps.filter(progress => shouldBookParentRun(progress, PARENT)).length, 0)
})
