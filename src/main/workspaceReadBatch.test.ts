/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_PARALLEL_READS, runWithConcurrency, selectLeadingReadBatch } from './workspaceReadBatch.ts'

const call = (id: string, name: string, args: Record<string, unknown> = {}) =>
  ({ id, name, arguments: JSON.stringify(args) })

test('only the reads before the first side effect are batched', () => {
  const batch = selectLeadingReadBatch([
    call('1', 'read_file', { path: 'a.ts' }),
    call('2', 'search_text', { query: 'foo' }),
    // Everything from here on must keep its order: the write invalidates what a
    // read issued after it would have returned.
    call('3', 'write_file', { path: 'a.ts', content: 'x' }),
    call('4', 'read_file', { path: 'a.ts' })
  ])
  assert.deepEqual(batch.map(({ id }) => id), ['1', '2'])
  assert.deepEqual(batch[0].args, { path: 'a.ts' })
})

test('a single read is left to the serial path', () => {
  assert.deepEqual(selectLeadingReadBatch([call('1', 'read_file', { path: 'a.ts' })]), [])
  // Two calls, but the second is not a read: nothing to overlap.
  assert.deepEqual(selectLeadingReadBatch([
    call('1', 'read_file', { path: 'a.ts' }),
    call('2', 'git_write', { operation: 'commit' })
  ]), [])
})

test('the batch stops at calls the client cannot run unattended', () => {
  const reads = [
    call('1', 'read_file', { path: 'a.ts' }),
    call('2', 'read_file', { path: 'b.ts' }),
    call('3', 'read_file', { path: 'c.ts' }),
    call('4', 'read_file', { path: 'd.ts' })
  ]
  // A rule or an earlier rejection makes a call approval-gated. Batching it
  // would execute it without ever showing the prompt, so the batch ends
  // before it and the serial path asks.
  const gated = selectLeadingReadBatch(reads, { eligible: (candidate) => candidate.args.path !== 'c.ts' })
  assert.deepEqual(gated.map(({ id }) => id), ['1', '2'])
  // Nothing before the gated call means nothing to batch at all.
  assert.deepEqual(selectLeadingReadBatch(reads.slice(2), { eligible: (candidate) => candidate.args.path !== 'c.ts' }), [])

  // Already executed ids are replays, not work.
  const replayed = selectLeadingReadBatch(reads, { skipIds: new Set(['1']) })
  assert.deepEqual(replayed.map(({ id }) => id), [])
})

test('unparseable arguments and unknown tools never enter a batch', () => {
  assert.deepEqual(selectLeadingReadBatch([{ id: '1', name: 'read_file', arguments: '{"path":' }]), [])
  assert.deepEqual(selectLeadingReadBatch([
    { id: '1', name: 'read_file', arguments: '[]' }
  ]), [])
  assert.deepEqual(selectLeadingReadBatch([
    call('1', 'some_extension_tool', { path: 'a' }),
    call('2', 'read_file', { path: 'b' })
  ]), [])
})

test('a batch is capped so it cannot flood the workspace', () => {
  const calls = Array.from({ length: 9 }, (_, index) => call(String(index), 'read_file', { path: `f${index}.ts` }))
  assert.equal(selectLeadingReadBatch(calls).length, MAX_PARALLEL_READS)
  assert.equal(selectLeadingReadBatch(calls, { limit: 3 }).length, 3)
  // A limit below two cannot be honoured without dropping the feature.
  assert.equal(selectLeadingReadBatch(calls, { limit: 1 }).length, 2)
})

test('concurrency keeps results in order and survives a failing item', async () => {
  let inFlight = 0
  let peak = 0
  const outcomes = await runWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (item) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, item === 3 ? 5 : 20))
    inFlight -= 1
    if (item === 3) throw new Error(`failed ${item}`)
    return item * 10
  })
  assert.equal(peak, 3, 'the limit is a ceiling, not a target')
  assert.deepEqual(outcomes.map((outcome) => outcome.ok ? outcome.value : 'error'), [10, 20, 'error', 40, 50, 60])
  // The failure keeps its own error, so the caller can report the real reason
  // instead of a generic "batch failed".
  const failure = outcomes[2]
  assert.equal(failure.ok, false)
  assert.match(String((failure as { error: Error }).error.message), /failed 3/)
})

test('an empty batch does not start a worker', async () => {
  let started = 0
  assert.deepEqual(await runWithConcurrency([], 4, async () => { started += 1 }), [])
  assert.equal(started, 0)
})
