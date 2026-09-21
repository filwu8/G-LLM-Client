/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { WorkspaceModelTransportError } from './workspaceModelTransport.ts'
import { readWorkspaceModelEventStream } from './workspaceModelStream.ts'
import {
  appendWorkspaceAssistantToolCalls,
  appendWorkspaceToolResult,
  buildWorkspaceChatCompletionRequest,
  formatWorkspaceToolResult,
  runWorkspaceModelAttempts,
  WorkspaceToolCallLedger,
  type WorkspaceChatCompletionMessage
} from './workspaceChatCompletions.ts'

const definitions = [
  { type: 'function', function: { name: 'run_python', parameters: { type: 'object' } } },
  { type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } },
  { type: 'function', function: { name: 'write_file', parameters: { type: 'object' } } }
]

function sse(payload: unknown): string { return `data: ${JSON.stringify(payload)}\n` }

test('simulates Chat Completions tool continuation with complete calls, matching results, context, and definitions', async () => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_python_fixture', type: 'function', function: { name: 'run_python', arguments: '{"code":"print(1)"}' } },
        { index: 1, id: 'call_read_fixture', type: 'function', function: { name: 'read_file', arguments: '{"path":"notes.txt"}' } }
      ] } }] })))
      controller.enqueue(encoder.encode(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })))
      controller.enqueue(encoder.encode('data: [DONE]\n'))
    }
  })
  const parsed = await readWorkspaceModelEventStream(body)
  assert.equal(parsed?.tool_calls?.length, 2)
  const calls = parsed!.tool_calls!

  const messages: WorkspaceChatCompletionMessage[] = [
    { role: 'system', content: 'fixture system context' },
    { role: 'user', content: 'fixture user goal' },
    { role: 'assistant', content: 'prior assistant context' }
  ]
  appendWorkspaceAssistantToolCalls(messages, null, calls)
  // A simulated AppContainer exit-code-1 is a local tool error result, not a
  // model transport failure. The model can inspect it on its next turn.
  appendWorkspaceToolResult(messages, calls[0].id, formatWorkspaceToolResult('simulated AppContainer denial', 1))
  appendWorkspaceToolResult(messages, calls[1].id, 'simulated file contents')

  const nextRequest = buildWorkspaceChatCompletionRequest({
    model: 'fixture-model',
    messages,
    tools: definitions,
    stream: true,
    temperature: 0.2,
    maxTokenOption: { max_tokens: 4096 }
  })
  const continued = nextRequest.messages as WorkspaceChatCompletionMessage[]
  assert.deepEqual(continued.map((message) => message.role), ['system', 'user', 'assistant', 'assistant', 'tool', 'tool'])
  assert.equal(continued[0].content, 'fixture system context')
  assert.equal(continued[1].content, 'fixture user goal')
  assert.deepEqual(continued[3].tool_calls, calls)
  assert.deepEqual(continued.slice(4).map((message) => message.tool_call_id), calls.map((call) => call.id))
  assert.match(String(continued[4].content), /exit code 1/)
  assert.deepEqual(nextRequest.tools, definitions)
  assert.equal(nextRequest.tool_choice, 'auto')
  assert.equal(nextRequest.stream, true)
  assert.equal('input' in nextRequest, false, 'Responses API fields must not be mixed into Chat Completions')
})

test('a completed malformed call is returned only after protocol completion for a correlated tool error', async () => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_bad_json_fixture', type: 'function', function: { name: 'read_file', arguments: '{not-json' } }
      ] } }] })))
      controller.enqueue(encoder.encode(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })))
      controller.enqueue(encoder.encode('data: [DONE]\n'))
    }
  })
  const result = await readWorkspaceModelEventStream(body)
  assert.equal(result?.tool_calls?.[0].id, 'call_bad_json_fixture')
  assert.equal(result?.tool_calls?.[0].function.arguments, '{not-json')
})

test('attempt IDs prevent blind timeout replay and allow only explicit rejected-status retries', async () => {
  const attempts: string[] = []
  await assert.rejects(runWorkspaceModelAttempts({
    runId: 'run_fixture',
    requestId: 'request_fixture',
    firstAttemptId: 'attempt_first',
    maxAttempts: 3,
    retryableStatuses: new Set([429]),
    createAttemptId: () => 'attempt_unused',
    runAttempt: async (identity) => {
      attempts.push(identity.attemptId)
      throw new WorkspaceModelTransportError('stream_idle_timeout', identity)
    }
  }), WorkspaceModelTransportError)
  assert.deepEqual(attempts, ['attempt_first'], 'ambiguous timeouts must not replay the generation request')

  attempts.length = 0
  const result = await runWorkspaceModelAttempts({
    runId: 'run_fixture',
    requestId: 'request_fixture',
    firstAttemptId: 'attempt_429',
    maxAttempts: 3,
    retryableStatuses: new Set([429]),
    createAttemptId: () => 'attempt_after_429',
    runAttempt: async (identity, attempt) => {
      attempts.push(`${identity.runId}/${identity.requestId}/${identity.attemptId}`)
      return attempt === 1 ? { status: 429, value: 'rejected' } : { status: 200, value: 'accepted' }
    }
  })
  assert.equal(result.value, 'accepted')
  assert.deepEqual(attempts, [
    'run_fixture/request_fixture/attempt_429',
    'run_fixture/request_fixture/attempt_after_429'
  ])
})

test('same tool call ID cannot execute a side effect twice and reuses its completed result', () => {
  const ledger = new WorkspaceToolCallLedger()
  let sideEffects = 0
  assert.equal(ledger.claim('call_side_effect_fixture'), true)
  sideEffects += 1
  ledger.complete('call_side_effect_fixture', 'simulated write complete')
  assert.equal(ledger.claim('call_side_effect_fixture'), false)
  if (ledger.claim('call_side_effect_fixture')) sideEffects += 1
  assert.equal(sideEffects, 1)
  assert.equal(ledger.replayResult('call_side_effect_fixture'), 'simulated write complete')
})
