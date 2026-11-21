/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createSeatProgressForwarder, shouldBookParentRun } from './seatProgressForward.ts'
import type { WorkspaceAgentProgress, WorkspaceToolActivity } from '../shared/types'

const PARENT = 'conv-console'
const SEAT = 'conv-console::seat-reviewer'

const parentEntry = (): WorkspaceToolActivity => ({
  id: 'delegate-1',
  tool: 'delegate_assistant',
  label: '调用协作助手',
  status: 'running',
  detail: ''
})

const seatStep = (id: string, label = id): WorkspaceAgentProgress => ({
  conversationId: SEAT,
  activity: { id, tool: 'read_file', label, status: 'completed', detail: label }
})

function collect() {
  const seen: WorkspaceAgentProgress[] = []
  return { seen, onProgress: (progress: WorkspaceAgentProgress) => { seen.push(progress) } }
}

test('a seat step reaches the seat verbatim and the console as one reused line', () => {
  const { seen, onProgress } = collect()
  const entry = parentEntry()
  const forward = createSeatProgressForwarder({
    parentConversationId: PARENT,
    seatConversationId: SEAT,
    seatAssistantId: 'seat-reviewer',
    seatName: '审稿席位',
    isEnglish: false,
    entry,
    onProgress
  })

  forward(seatStep('step-1', '读 README'))
  forward(seatStep('step-2', '改链接'))

  // Seat side sees both steps exactly as produced.
  assert.deepEqual(seen.filter(progress => progress.conversationId === SEAT).map(progress => progress.activity.id), ['step-1', 'step-2'])
  // Console side gets the same entry updated, never a second one.
  const consoleLines = seen.filter(progress => progress.conversationId === PARENT)
  assert.equal(consoleLines.length, 2)
  assert.deepEqual(consoleLines.map(progress => progress.activity.id), ['delegate-1', 'delegate-1'])
  const [firstLine, secondLine] = consoleLines
  assert.ok(firstLine && secondLine)
  assert.match(firstLine.activity.detail ?? '', /第 1 步/)
  assert.match(secondLine.activity.detail ?? '', /第 2 步/)
  assert.match(secondLine.activity.detail ?? '', /改链接/)
})

test('the console line carries the seat identity and is marked as progress, not a tool call', () => {
  const { seen, onProgress } = collect()
  const entry = parentEntry()
  const forward = createSeatProgressForwarder({
    parentConversationId: PARENT,
    seatConversationId: SEAT,
    seatAssistantId: 'seat-reviewer',
    seatName: '审稿席位',
    isEnglish: true,
    entry,
    onProgress
  })

  forward(seatStep('step-1'))

  const line = seen.find(progress => progress.conversationId === PARENT)?.activity
  assert.equal(line?.seat, '审稿席位')
  assert.equal(line?.seatAssistantId, 'seat-reviewer')
  assert.equal(line?.seatConversationId, SEAT)
  assert.equal(line?.delegatedStep, true)
  assert.match(line?.detail ?? '', /step 1/)
})

test('the console does not get a line for progress that belongs to itself or another run', () => {
  const { seen, onProgress } = collect()
  const entry = parentEntry()
  const forward = createSeatProgressForwarder({
    parentConversationId: PARENT,
    seatConversationId: SEAT,
    seatAssistantId: 'seat-reviewer',
    seatName: '审稿席位',
    isEnglish: false,
    entry,
    onProgress
  })

  forward({ conversationId: PARENT, activity: { id: 'own-1', tool: 'read_file', label: '总台自己读文件', status: 'completed', detail: '' } })

  assert.equal(seen.length, 1)
  assert.equal(seen[0]?.conversationId, PARENT)
  assert.equal(seen[0]?.activity.id, 'own-1')
  assert.equal(entry.detail, '')
})

test('a seat run without a console entry still forwards its own steps', () => {
  const { seen, onProgress } = collect()
  const forward = createSeatProgressForwarder({
    parentConversationId: PARENT,
    seatConversationId: SEAT,
    seatAssistantId: 'seat-reviewer',
    seatName: '审稿席位',
    isEnglish: false,
    onProgress
  })

  forward(seatStep('step-1'))

  assert.equal(seen.length, 1)
  assert.equal(seen[0]?.conversationId, SEAT)
})

test('a run only books its own dispatch, never the seat steps it forwards', () => {
  const seatStepProgress = seatStep('step-1')
  const consoleOwn: WorkspaceAgentProgress = {
    conversationId: PARENT,
    activity: { id: 'own-1', tool: 'read_file', label: '总台自己读文件', status: 'completed', detail: '' }
  }
  const consoleSummary: WorkspaceAgentProgress = {
    conversationId: PARENT,
    activity: { ...parentEntry(), delegatedStep: true }
  }

  assert.equal(shouldBookParentRun(seatStepProgress, PARENT), false)
  assert.equal(shouldBookParentRun(consoleOwn, PARENT), true)
  assert.equal(shouldBookParentRun(consoleSummary, PARENT), false)
  // One dispatch to five seats is booked once, not once per seat step.
  const seatSteps = ['a', 'b', 'c', 'd', 'e'].map(id => seatStep(id))
  assert.equal(seatSteps.filter(progress => shouldBookParentRun(progress, PARENT)).length, 0)
})
