/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { readWorkspaceModelEventStream } from './workspaceModelStream.ts'
import {
  fetchWorkspaceModelResponse,
  readWorkspaceModelChunk,
  withWorkspaceModelTotalTimeout,
  WorkspaceModelTransportError,
  workspaceModelRequestHeaders,
  type WorkspaceModelRequestIdentity
} from './workspaceModelTransport.ts'

const identity: WorkspaceModelRequestIdentity = { runId: 'run-safe-01', requestId: 'req-safe-02', attemptId: 'attempt-safe-03' }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('Chat Completions attempts carry correlated run, request, and attempt IDs without requiring a key', async () => {
  const headers = new Headers(workspaceModelRequestHeaders(undefined, identity))
  assert.equal(headers.get('X-G-LLM-Run-ID'), identity.runId)
  assert.equal(headers.get('X-G-LLM-Request-ID'), identity.requestId)
  assert.equal(headers.get('X-G-LLM-Attempt-ID'), identity.attemptId)
  assert.equal(headers.has('Authorization'), false)

  let observed: RequestInit | undefined
  const response = await fetchWorkspaceModelResponse({
    url: 'https://provider.invalid/v1/chat/completions',
    body: { model: 'fixture-model', messages: [{ role: 'user', content: 'fixture' }], stream: true },
    identity,
    connectionTimeoutMs: 100,
    fetcher: async (_url, options) => { observed = options; return new Response('{}', { status: 200 }) }
  })
  assert.equal(response.status, 200)
  assert.equal(new Headers(observed?.headers).get('X-G-LLM-Attempt-ID'), identity.attemptId)
  assert.deepEqual(JSON.parse(String(observed?.body)), { model: 'fixture-model', messages: [{ role: 'user', content: 'fixture' }], stream: true })
})

test('connection/header timeout is classified separately and never triggers an implicit retry', async () => {
  let calls = 0
  await assert.rejects(fetchWorkspaceModelResponse({
    url: 'https://provider.invalid/v1/chat/completions',
    body: { model: 'fixture-model', messages: [], stream: true },
    identity,
    connectionTimeoutMs: 15,
    fetcher: async () => { calls += 1; return await new Promise<Response>(() => undefined) }
  }), (error: unknown) => error instanceof WorkspaceModelTransportError && error.phase === 'connection_timeout' && error.identity.attemptId === identity.attemptId)
  assert.equal(calls, 1)
})

test('connection failures before response headers are not mislabeled as stream interruption', async () => {
  await assert.rejects(fetchWorkspaceModelResponse({
    url: 'https://provider.invalid/v1/chat/completions',
    body: { model: 'fixture-model', messages: [], stream: true },
    identity,
    fetcher: async () => { throw new Error('simulated ECONNRESET') }
  }), (error: unknown) => error instanceof WorkspaceModelTransportError && error.phase === 'connection_error')
})

test('SSE heartbeats reset transport idle timeout without becoming model content', async () => {
  const encoder = new TextEncoder()
  let canceled = false
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await wait(15); controller.enqueue(encoder.encode(': PING\n'))
      await wait(15); controller.enqueue(encoder.encode(': keepalive\n'))
      await wait(15); controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ready"}}]}\n'))
      controller.enqueue(encoder.encode('data: [DONE]\n'))
    },
    cancel() { canceled = true }
  })
  let receivedBytes = false
  const message = await readWorkspaceModelEventStream(body, async (reader) => {
    const chunk = await readWorkspaceModelChunk(reader, undefined, identity, receivedBytes ? 'stream_idle_timeout' : 'first_byte_timeout', 25)
    if (chunk.value?.byteLength) receivedBytes = true
    return chunk
  })
  assert.equal(message?.content, 'ready')
  assert.deepEqual(message?.tool_calls, undefined)
  assert.equal(canceled, true)
})

test('first-byte and stream-idle timeouts are distinct', async () => {
  const firstByteBody = new ReadableStream<Uint8Array>({ async start(controller) { await wait(30); controller.enqueue(new TextEncoder().encode('late')) } })
  await assert.rejects(readWorkspaceModelChunk(firstByteBody.getReader(), undefined, identity, 'first_byte_timeout', 10), (error: unknown) => error instanceof WorkspaceModelTransportError && error.phase === 'first_byte_timeout')

  const idleBody = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(': PING\n')) } })
  const reader = idleBody.getReader()
  assert.equal((await reader.read()).done, false)
  await assert.rejects(readWorkspaceModelChunk(reader, undefined, identity, 'stream_idle_timeout', 10), (error: unknown) => error instanceof WorkspaceModelTransportError && error.phase === 'stream_idle_timeout')
})

test('total response deadline is independent of read/heartbeat activity', async () => {
  await assert.rejects(withWorkspaceModelTotalTimeout(identity, undefined, async () => {
    await wait(30)
    return 'too late'
  }, 10), (error: unknown) => error instanceof WorkspaceModelTransportError && error.phase === 'total_timeout' && error.upstreamState === 'unknown')
})
