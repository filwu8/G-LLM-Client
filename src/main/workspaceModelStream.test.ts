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

test('accumulates tool-call arguments by index and withholds calls until finish_reason', () => {
  const parser = new WorkspaceModelStreamParser()
  parser.push(`${data({ choices: [{ delta: { tool_calls: [
    { index: 1, id: 'call_b', type: 'function', function: { name: 'write_', arguments: '{"text":"hel' } },
    { index: 0, id: 'call_', type: 'function', function: { name: 'list_file', arguments: '{"path":' } }
  ] } }] })}\n`)
  parser.push(`${data({ choices: [{ delta: { tool_calls: [
    { index: 1, function: { name: 'file', arguments: 'lo"}' } },
    { index: 0, id: 'a', function: { arguments: '"notes.md"}' } }
  ] } }] })}\n`)

  assert.equal(parser.result()?.tool_calls, undefined)

  parser.push(`${data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n`)
  assert.deepEqual(parser.result()?.tool_calls, [
    {
      id: 'call_a',
      type: 'function',
      function: { name: 'list_file', arguments: '{"path":"notes.md"}' }
    },
    {
      id: 'call_b',
      type: 'function',
      function: { name: 'write_file', arguments: '{"text":"hello"}' }
    }
  ])
})

test('ignores SSE keep-alive comments while no model content has arrived', () => {
  const parser = new WorkspaceModelStreamParser()
  parser.push(': PING\n: keepalive\n')

  assert.equal(parser.finished, false)
  assert.equal(parser.result(), undefined)

  parser.push(`${data({ choices: [{ delta: { content: 'heartbeat did not become text' } }] })}\ndata: [DONE]\n`)
  assert.equal(parser.result()?.content, 'heartbeat did not become text')
})

test('withholds incomplete calls before completion and preserves completed invalid args for a correlated tool error', () => {
  const parser = new WorkspaceModelStreamParser()
  parser.push(`${data({ choices: [{ delta: { tool_calls: [
    { index: 0, id: 'call_incomplete', function: { name: 'list_file', arguments: '{"path":' } },
    { index: 1, id: 'call_invalid', function: { name: 'write_file', arguments: '{not-json}' } }
  ] } }] })}\n`)
  assert.equal(parser.result()?.tool_calls, undefined)

  parser.push('data: [DONE]\n')

  assert.deepEqual(parser.result()?.tool_calls, [
    { id: 'call_incomplete', type: 'function', function: { name: 'list_file', arguments: '{"path":' } },
    { id: 'call_invalid', type: 'function', function: { name: 'write_file', arguments: '{not-json}' } }
  ])
})

test('rejects EOF after partial content or tool arguments without a Chat Completions finish marker', async () => {
  const incomplete = `${data({ choices: [{ delta: {
    content: '部分回答',
    tool_calls: [{ index: 0, id: 'call_partial', function: { name: 'list_file', arguments: '{"path":' } }]
  } }] })}\n`
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(incomplete))
      controller.close()
    }
  })

  await assert.rejects(readWorkspaceModelEventStream(body), /模型流式响应未完整结束/)
})

test('accepts EOF after a valid Chat Completions tool_calls finish_reason', async () => {
  const completed = `${data({ choices: [{
    delta: { tool_calls: [{
      index: 0,
      id: 'call_complete',
      type: 'function',
      function: { name: 'list_file', arguments: '{"path":"notes.md"}' }
    }] },
    finish_reason: 'tool_calls'
  }] })}\n`
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(completed))
      controller.close()
    }
  })

  assert.deepEqual((await readWorkspaceModelEventStream(body))?.tool_calls, [{
    id: 'call_complete',
    type: 'function',
    function: { name: 'list_file', arguments: '{"path":"notes.md"}' }
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

test('returns and cancels immediately at a Chat Completions finish_reason without waiting for DONE or socket close', async () => {
  let canceled = false
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${data({ choices: [{
        delta: { tool_calls: [{ index: 0, id: 'call_finished', function: { name: 'read_file', arguments: '{}' } }] },
        finish_reason: 'tool_calls'
      }] })}\n`))
    },
    cancel() { canceled = true }
  })

  const result = await Promise.race([
    readWorkspaceModelEventStream(body),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('stream did not finish at finish_reason')), 100))
  ])
  assert.equal(result?.tool_calls?.[0].id, 'call_finished')
  assert.equal(canceled, true)
})
