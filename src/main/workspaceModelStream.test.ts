/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { readWorkspaceModelEventStream, WorkspaceModelStreamParser } from './workspaceModelStream.ts'

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}`
}

test('drains Nemotron reasoning and content records separated by one newline', () => {
  const parser = new WorkspaceModelStreamParser()
  const reasoning = data({ choices: [{ delta: { reasoning_content: 'thinking' } }] })
  const answer = data({ choices: [{ delta: { content: '工作区回复正常' } }] })
  const stream = `${reasoning}\n${answer}\ndata: [DONE]\n`

  parser.push(stream.slice(0, 37))
  assert.equal(parser.result(), undefined)
  parser.push(stream.slice(37))

  assert.equal(parser.finished, true)
  assert.equal(parser.result()?.content, '工作区回复正常')
})

test('aggregates streamed tool calls from single-newline records', () => {
  const parser = new WorkspaceModelStreamParser()
  parser.push(`${data({
    choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'list_', arguments: '{\"path\":' } }] } }]
  })}\n`)
  parser.push(`${data({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'directory', arguments: '\".\"}' } }] } }]
  })}\ndata: [DONE]\n`)

  assert.deepEqual(parser.result()?.tool_calls, [{
    id: 'call_1',
    type: 'function',
    function: { name: 'list_directory', arguments: '{\"path\":\".\"}' }
  }])
})

test('continues to accept standard blank-line SSE events', () => {
  const parser = new WorkspaceModelStreamParser()
  parser.push(`${data({ choices: [{ delta: { content: 'standard SSE' } }] })}\n\ndata: [DONE]\n\n`)

  assert.equal(parser.finished, true)
  assert.equal(parser.result()?.content, 'standard SSE')
})

test('retains metadata when a reasoning model returns no final content', () => {
  const parser = new WorkspaceModelStreamParser()
  parser.push(`${data({ choices: [{ delta: { reasoning_content: 'only reasoning' }, finish_reason: 'length' }] })}\ndata: [DONE]\n`)

  assert.deepEqual(parser.result(), {
    content: null,
    tool_calls: undefined,
    reasoningCharacters: 14,
    finishReason: 'length'
  })
})

test('returns at single-line DONE without waiting for the connection to close', async () => {
  let canceled = false
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${data({ choices: [{ delta: { content: '立即返回' } }] })}\ndata: [DONE]\n`))
    },
    cancel() {
      canceled = true
    }
  })

  const result = await Promise.race([
    readWorkspaceModelEventStream(body),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stream did not finish')), 100))
  ])

  assert.equal(result?.content, '立即返回')
  assert.equal(canceled, true)
})
