/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { z } from 'zod'
import {
  connectMcpTransport,
  formatMcpCallResult,
  formatMcpCommandLine,
  isMcpStdioTool,
  McpRuntimeManager,
  mcpToolFunctionName,
  parseMcpCommandLine,
  resolveMcpConnectionSpec
} from './mcpClient.ts'

test('parseMcpCommandLine splits quoted executables and arguments safely', () => {
  assert.deepEqual(
    parseMcpCommandLine('"C:/Program Files/nodejs/npx.cmd" -y @modelcontextprotocol/server-filesystem "C:/My Data"'),
    {
      command: 'C:/Program Files/nodejs/npx.cmd',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/My Data']
    }
  )
  assert.throws(() => parseMcpCommandLine('npx "unclosed'), /未闭合的引号/)
})

test('resolveMcpConnectionSpec infers stdio vs streamable-http and validates URLs', () => {
  const stdio = resolveMcpConnectionSpec({
    mcpTransport: 'auto',
    endpoint: 'npx -y @modelcontextprotocol/server-everything'
  })
  assert.equal(stdio.transport, 'stdio')
  assert.equal(stdio.command, 'npx')
  assert.deepEqual(stdio.args, ['-y', '@modelcontextprotocol/server-everything'])

  const httpSpec = resolveMcpConnectionSpec({
    mcpTransport: 'auto',
    endpoint: 'https://mcp.example.com/mcp',
    mcpHeaders: { Authorization: 'Bearer tok' }
  })
  assert.equal(httpSpec.transport, 'streamable-http')
  assert.equal(httpSpec.autoFallbackToSse, true)
  assert.equal(httpSpec.url, 'https://mcp.example.com/mcp')

  assert.throws(() => resolveMcpConnectionSpec({
    mcpTransport: 'sse',
    endpoint: 'file:///etc/passwd'
  }), /http:\/\/ 或 https:\/\//)

  assert.equal(isMcpStdioTool({ mcpTransport: 'auto', endpoint: 'npx server' }), true)
  assert.equal(isMcpStdioTool({ mcpTransport: 'auto', endpoint: 'https://mcp.example.com/mcp' }), false)
})

test('mcpToolFunctionName produces unique <=64 char OpenAI-safe identifiers', () => {
  const a = mcpToolFunctionName('tool_1', 'search_docs')
  const b = mcpToolFunctionName('tool_2', 'search_docs')
  assert.notEqual(a, b)
  assert.ok(a.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(a))

  const veryLong = mcpToolFunctionName('tool_long', 'very_long_tool_name_'.repeat(6))
  assert.ok(veryLong.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(veryLong))
})

test('formatMcpCallResult handles text, resource, image and error responses', () => {
  const formatted = formatMcpCallResult({
    content: [
      { type: 'text', text: 'hello' },
      { type: 'resource', resource: { uri: 'file:///a.txt', text: 'body' } },
      { type: 'image', mimeType: 'image/png' }
    ],
    isError: true
  })
  assert.equal(formatted.isError, true)
  assert.match(formatted.output, /hello/)
  assert.match(formatted.output, /\[Resource file:\/\/\/a\.txt\]/)
  assert.match(formatted.output, /\[MCP image content: image\/png\]/)
})

test('MCP client connects to an MCP server, discovers tools, and executes tool calls', async () => {
  const server = new McpServer({ name: 'test-mcp', version: '1.0.0' })
  server.registerTool(
    'add_numbers',
    {
      description: 'Add two numbers',
      inputSchema: { a: z.number(), b: z.number() }
    },
    async ({ a, b }) => ({
      content: [{ type: 'text', text: String(a + b) }]
    })
  )

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = await connectMcpTransport(clientTransport, 5_000)

  try {
    const listed = await client.listTools()
    assert.equal(listed.tools.length, 1)
    assert.equal(listed.tools[0].name, 'add_numbers')

    const result = await client.callTool({ name: 'add_numbers', arguments: { a: 7, b: 35 } })
    const formatted = formatMcpCallResult(result as { content?: Array<Record<string, unknown>>; isError?: boolean })
    assert.equal(formatted.isError, false)
    assert.equal(formatted.output, '42')
  } finally {
    await client.close()
    await server.close()
  }
})

test('McpRuntimeManager executes real stdio MCP server end-to-end', async () => {
  const manager = new McpRuntimeManager()
  const script = `
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { z } from 'zod';
    const server = new McpServer({ name: 'stdio-echo', version: '0.1.0' });
    server.registerTool('echo_upper', { description: 'Uppercase text', inputSchema: { text: z.string() } }, async ({ text }) => ({
      content: [{ type: 'text', text: text.toUpperCase() }]
    }));
    await server.connect(new StdioServerTransport());
  `
  const toolConfig = {
    id: 'mcp_stdio_test',
    type: 'mcp' as const,
    name: 'Stdio Echo',
    mcpTransport: 'stdio' as const,
    mcpCommand: process.execPath,
    mcpArgs: ['--input-type=module', '-e', script],
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }

  try {
    const tested = await manager.testConnection(toolConfig)
    assert.equal(tested.ok, true, tested.error)
    assert.equal(tested.transport, 'stdio')
    assert.equal(tested.serverName, 'stdio-echo')
    assert.equal(tested.tools[0]?.name, 'echo_upper')

    const callResult = await manager.callTool(toolConfig, 'echo_upper', { text: 'gllm' })
    assert.equal(callResult.isError, false)
    assert.equal(callResult.output, 'GLLM')
  } finally {
    await manager.closeAll()
  }
})

test('formatMcpCommandLine round-trips through the parser, including quoted arguments', () => {
  // The settings form stores a stdio server as one editable line and re-renders
  // it from the saved program plus arguments. If the two directions disagree,
  // saving an edit silently rewrites the server: arguments are the part users
  // notice last and debug longest.
  const cases = [
    { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/My Data'] },
    { command: 'C:/Program Files/nodejs/node.exe', args: ['--experimental-strip-types', 'server.ts'] },
    { command: 'node', args: ['say "hi"', "it's", 'a\\b', ''] },
    { command: 'server', args: ['tab\there', 'trailing backslash\\'] }
  ]
  for (const { command, args } of cases) {
    const line = formatMcpCommandLine(command, args)
    assert.deepEqual(parseMcpCommandLine(line), { command, args }, `round trip failed for: ${line}`)
  }
})

test('isMcpStdioTool matches the transport the client will actually build', () => {
  // This predicate decides whether a call runs as a local process outside the
  // workspace sandbox and therefore must always be approved. A wrong `false`
  // would make the client treat a spawned process as confined.
  assert.equal(isMcpStdioTool({ mcpTransport: undefined, endpoint: 'npx server' }), true)
  assert.equal(isMcpStdioTool({ mcpTransport: 'stdio', mcpCommand: 'npx', mcpArgs: ['-y', 'srv'] }), true)
  assert.equal(isMcpStdioTool({ mcpTransport: 'auto', endpoint: 'npx -y @modelcontextprotocol/server-everything' }), true)
  assert.equal(isMcpStdioTool({ mcpTransport: 'auto', endpoint: 'http://localhost:3000/mcp' }), false)
  assert.equal(isMcpStdioTool({ mcpTransport: 'streamable-http', endpoint: 'https://mcp.example.com/mcp' }), false)
  assert.equal(isMcpStdioTool({ mcpTransport: 'sse', mcpCommand: 'https://mcp.example.com/sse' }), false)
})

test('a failed MCP call is not replayed, so a side effect cannot happen twice', async () => {
  // The retry exists for a transport that closed between turns. Replaying on any
  // other error is unsafe: a server can perform its work and still answer with a
  // protocol error (a lost response, an output that fails validation), so a
  // second attempt would duplicate an issue, a message or a payment. The server
  // process records every start, which makes a silent replay observable.
  const dir = await mkdtemp(join(tmpdir(), 'gllm-mcp-replay-'))
  const marker = join(dir, 'starts.log')
  const script = `
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import { appendFileSync } from 'node:fs';
    const marker = ${JSON.stringify(marker)};
    appendFileSync(marker, 'start\\n');
    const server = new McpServer({ name: 'flaky', version: '0.1.0' });
    await server.connect(new StdioServerTransport());
  `
  const manager = new McpRuntimeManager()
  const toolConfig = {
    id: 'mcp_replay_test',
    type: 'mcp' as const,
    name: 'Flaky',
    mcpTransport: 'stdio' as const,
    mcpCommand: process.execPath,
    mcpArgs: ['--input-type=module', '-e', script],
    enabled: true,
    createdAt: 1,
    updatedAt: 1
  }

  try {
    await assert.rejects(() => manager.callTool(toolConfig, 'missing_tool', {}), 'the call must surface the failure')
    const started = await readFile(marker, 'utf8')
    assert.equal(started.trim().split('\n').length, 1, 'the server was restarted to replay a call that already failed')
  } finally {
    await manager.closeAll()
    await rm(dir, { recursive: true, force: true })
  }
})
