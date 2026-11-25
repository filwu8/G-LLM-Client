/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { isHttpUrl, parseMcpCommandLine } from '../shared/mcpCommandLine.ts'
import type { McpDiscoveredTool, McpTestResult, McpTransportType, ToolConfig } from '../shared/types'

// Re-exported so the main-process MCP entry point keeps exposing the command
// line helpers its tests and call sites already import from here.
export { formatMcpCommandLine, parseMcpCommandLine } from '../shared/mcpCommandLine.ts'

export type ResolvedMcpTransport = Exclude<McpTransportType, 'auto'>

export type McpConnectionSpec =
  | {
      transport: 'stdio'
      autoFallbackToSse: false
      command: string
      args: string[]
      env?: Record<string, string>
      cwd?: string
    }
  | {
      transport: 'streamable-http' | 'sse'
      autoFallbackToSse: boolean
      url: string
      headers?: Record<string, string>
    }

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000
const DEFAULT_CALL_TIMEOUT_MS = 60_000
const MAX_MCP_TOOL_OUTPUT_CHARS = 50_000

export function resolveMcpConnectionSpec(tool: Pick<ToolConfig, 'mcpTransport' | 'mcpCommand' | 'mcpArgs' | 'mcpEnv' | 'mcpCwd' | 'mcpHeaders' | 'endpoint'>): McpConnectionSpec {
  const requested: McpTransportType = tool.mcpTransport ?? 'auto'
  const rawEndpoint = (tool.endpoint ?? '').trim()
  const rawCommand = (tool.mcpCommand ?? '').trim()
  const primaryInput = rawCommand || rawEndpoint

  const wantsHttp = requested === 'streamable-http' || requested === 'sse' || (requested === 'auto' && isHttpUrl(rawEndpoint || primaryInput))
  if (wantsHttp) {
    const urlInput = rawEndpoint || rawCommand
    if (!isHttpUrl(urlInput)) {
      throw new Error('MCP HTTP/SSE 服务地址必须是有效的 http:// 或 https:// URL')
    }
    return {
      transport: requested === 'sse' ? 'sse' : 'streamable-http',
      autoFallbackToSse: requested === 'auto',
      url: urlInput,
      headers: tool.mcpHeaders && Object.keys(tool.mcpHeaders).length > 0 ? { ...tool.mcpHeaders } : undefined
    }
  }

  if (!primaryInput) {
    throw new Error('请填写 MCP 启动命令或服务地址')
  }

  let command = primaryInput
  let args = Array.isArray(tool.mcpArgs) ? tool.mcpArgs.map(String).filter((item) => item.length > 0) : []
  if (args.length === 0) {
    const parsed = parseMcpCommandLine(primaryInput)
    command = parsed.command
    args = parsed.args
  }
  if (!command) {
    throw new Error('MCP 启动命令不能为空')
  }

  return {
    transport: 'stdio',
    autoFallbackToSse: false,
    command,
    args,
    env: tool.mcpEnv && Object.keys(tool.mcpEnv).length > 0 ? { ...tool.mcpEnv } : undefined,
    cwd: tool.mcpCwd?.trim() || undefined
  }
}

export function isMcpStdioTool(tool: Pick<ToolConfig, 'mcpTransport' | 'mcpCommand' | 'mcpArgs' | 'endpoint'>): boolean {
  try {
    return resolveMcpConnectionSpec(tool).transport === 'stdio'
  } catch {
    return tool.mcpTransport === 'stdio'
  }
}

export function mcpToolFunctionName(toolConfigId: string, mcpToolName: string): string {
  const hash = createHash('sha256').update(toolConfigId).digest('hex').slice(0, 8)
  const sanitized = mcpToolName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'tool'
  const prefix = `mcp_${hash}_`
  const maxToolChars = 64 - prefix.length
  if (sanitized.length <= maxToolChars) return `${prefix}${sanitized}`
  const toolHash = createHash('sha256').update(mcpToolName).digest('hex').slice(0, 6)
  return `${prefix}${sanitized.slice(0, maxToolChars - 7)}_${toolHash}`
}

function sanitizeJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {}, additionalProperties: true }
  }
  const record = schema as Record<string, unknown>
  if (record.type === 'object' || record.properties || record.anyOf || record.oneOf) {
    return record
  }
  return { type: 'object', properties: {}, additionalProperties: true }
}

function normalizeDiscoveredTools(tools: Array<{ name: string; description?: string; inputSchema?: unknown }>): McpDiscoveredTool[] {
  return tools.slice(0, 200).map((item) => ({
    name: String(item.name),
    description: typeof item.description === 'string' && item.description.trim() ? item.description.trim().slice(0, 1000) : undefined,
    inputSchema: sanitizeJsonSchema(item.inputSchema)
  }))
}

export function formatMcpCallResult(result: {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  isError?: boolean
}): { output: string; isError: boolean } {
  const parts: string[] = []
  for (const item of result.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
    } else if (item.type === 'image') {
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType : 'image'
      parts.push(`[MCP image content: ${mimeType}]`)
    } else if (item.type === 'audio') {
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType : 'audio'
      parts.push(`[MCP audio content: ${mimeType}]`)
    } else if (item.type === 'resource' && item.resource && typeof item.resource === 'object') {
      const resource = item.resource as Record<string, unknown>
      const uri = typeof resource.uri === 'string' ? resource.uri : ''
      const text = typeof resource.text === 'string' ? resource.text : ''
      parts.push(text ? `[Resource ${uri}]\n${text}` : `[Resource ${uri}]`)
    } else if (item.type === 'resource_link') {
      const uri = typeof item.uri === 'string' ? item.uri : ''
      const name = typeof item.name === 'string' ? item.name : uri
      parts.push(`[Resource link: ${name} (${uri})]`)
    } else {
      parts.push(JSON.stringify(item))
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent, null, 2))
  }
  const text = parts.join('\n\n').trim() || '[MCP tool returned empty output]'
  return {
    output: text.slice(0, MAX_MCP_TOOL_OUTPUT_CHARS),
    isError: Boolean(result.isError)
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted'))
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(message)), timeoutMs)
    timer.unref?.()
    const onAbort = () => {
      clearTimeout(timer)
      rejectPromise(signal?.reason ?? new Error('Aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (error) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        rejectPromise(error)
      }
    )
  })
}

function createTransport(spec: McpConnectionSpec, transportOverride?: 'streamable-http' | 'sse'): Transport {
  if (spec.transport === 'stdio') {
    const env = spec.env ? { ...getDefaultEnvironment(), ...spec.env } : getDefaultEnvironment()
    return new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env,
      cwd: spec.cwd,
      stderr: 'pipe'
    })
  }
  const selected = transportOverride ?? spec.transport
  const requestInit: RequestInit | undefined = spec.headers ? { headers: spec.headers } : undefined
  if (selected === 'sse') {
    return new SSEClientTransport(new URL(spec.url), { requestInit })
  }
  return new StreamableHTTPClientTransport(new URL(spec.url), { requestInit })
}

export async function connectMcpTransport(
  transport: Transport,
  timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<Client> {
  const client = new Client({ name: 'g-llm-client', version: '2.0.33' }, { capabilities: {} })
  await withTimeout(client.connect(transport), timeoutMs, '连接 MCP 服务超时', signal)
  return client
}

interface PooledMcpSession {
  signature: string
  transportType: ResolvedMcpTransport
  client: Client
  transport: Transport
  /** Set once the transport reports it closed, so a failed call can tell
   * "never reached the server" apart from "the server answered with an error". */
  closed: boolean
}

export class McpRuntimeManager {
  private readonly sessions = new Map<string, PooledMcpSession>()
  private readonly connecting = new Map<string, Promise<PooledMcpSession>>()

  private signatureFor(tool: ToolConfig, spec: McpConnectionSpec): string {
    return JSON.stringify({ id: tool.id, spec })
  }

  private async openSession(tool: ToolConfig, timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS, signal?: AbortSignal): Promise<PooledMcpSession> {
    const spec = resolveMcpConnectionSpec(tool)
    const signature = this.signatureFor(tool, spec)

    const connectAttempt = async (transportOverride?: 'streamable-http' | 'sse'): Promise<PooledMcpSession> => {
      const transportType: ResolvedMcpTransport = spec.transport === 'stdio' ? 'stdio' : (transportOverride ?? spec.transport)
      const transport = createTransport(spec, transportOverride)
      const stderrChunks: string[] = []
      if (transport instanceof StdioClientTransport && transport.stderr) {
        transport.stderr.on('data', (chunk: Buffer | string) => {
          if (stderrChunks.length < 20) stderrChunks.push(String(chunk).slice(0, 500))
        })
      }
      try {
        const client = await connectMcpTransport(transport, timeoutMs, signal)
        const session: PooledMcpSession = { signature, transportType, client, transport, closed: false }
        client.onclose = () => {
          session.closed = true
          if (this.sessions.get(tool.id) === session) {
            this.sessions.delete(tool.id)
          }
        }
        return session
      } catch (error) {
        await transport.close().catch(() => undefined)
        const stderrDetail = stderrChunks.join('').trim().slice(0, 400)
        if (stderrDetail && error instanceof Error && !error.message.includes(stderrDetail)) {
          throw new Error(`${error.message} (${stderrDetail})`)
        }
        throw error
      }
    }

    if (spec.transport !== 'stdio' && spec.autoFallbackToSse) {
      try {
        return await connectAttempt('streamable-http')
      } catch (primaryError) {
        try {
          return await connectAttempt('sse')
        } catch {
          throw primaryError
        }
      }
    }

    return connectAttempt()
  }

  private async getOrCreateSession(tool: ToolConfig, signal?: AbortSignal): Promise<PooledMcpSession> {
    const spec = resolveMcpConnectionSpec(tool)
    const signature = this.signatureFor(tool, spec)
    const existing = this.sessions.get(tool.id)
    if (existing) {
      if (existing.signature === signature) return existing
      await this.invalidate(tool.id)
    }

    const inflight = this.connecting.get(tool.id)
    if (inflight) return inflight

    const pending = this.openSession(tool, DEFAULT_CONNECT_TIMEOUT_MS, signal)
      .then((session) => {
        this.sessions.set(tool.id, session)
        return session
      })
      .finally(() => {
        if (this.connecting.get(tool.id) === pending) {
          this.connecting.delete(tool.id)
        }
      })

    this.connecting.set(tool.id, pending)
    return pending
  }

  async testConnection(tool: ToolConfig, signal?: AbortSignal): Promise<McpTestResult> {
    const testedAt = Date.now()
    let spec: McpConnectionSpec
    try {
      spec = resolveMcpConnectionSpec(tool)
    } catch (error) {
      return {
        ok: false,
        transport: tool.mcpTransport === 'sse' ? 'sse' : tool.mcpTransport === 'streamable-http' ? 'streamable-http' : 'stdio',
        tools: [],
        error: error instanceof Error ? error.message : String(error),
        testedAt
      }
    }

    await this.invalidate(tool.id)
    let session: PooledMcpSession | undefined
    try {
      session = await this.openSession(tool, DEFAULT_CONNECT_TIMEOUT_MS, signal)
      const listed = await withTimeout(session.client.listTools(), DEFAULT_CONNECT_TIMEOUT_MS, '获取 MCP 工具列表超时', signal)
      const version = session.client.getServerVersion()
      return {
        ok: true,
        transport: session.transportType,
        serverName: version?.name,
        serverVersion: version?.version,
        tools: normalizeDiscoveredTools(listed.tools ?? []),
        testedAt
      }
    } catch (error) {
      return {
        ok: false,
        transport: session?.transportType ?? (spec.transport === 'stdio' ? 'stdio' : spec.transport),
        tools: [],
        error: error instanceof Error ? error.message : String(error),
        testedAt
      }
    } finally {
      if (session) {
        await session.client.close().catch(() => undefined)
      }
    }
  }

  async listTools(tool: ToolConfig, signal?: AbortSignal): Promise<McpDiscoveredTool[]> {
    const session = await this.getOrCreateSession(tool, signal)
    const listed = await withTimeout(session.client.listTools(), DEFAULT_CONNECT_TIMEOUT_MS, `获取 MCP “${tool.name}” 工具列表超时`, signal)
    return normalizeDiscoveredTools(listed.tools ?? [])
  }

  async callTool(
    tool: ToolConfig,
    mcpToolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<{ output: string; isError: boolean }> {
    const invoke = async (session: PooledMcpSession) => {
      const result = await withTimeout(
        session.client.callTool({ name: mcpToolName, arguments: args }),
        DEFAULT_CALL_TIMEOUT_MS,
        `调用 MCP 工具 “${tool.name}/${mcpToolName}” 超时`,
        signal
      )
      return formatMcpCallResult(result as { content?: Array<Record<string, unknown>>; structuredContent?: Record<string, unknown>; isError?: boolean })
    }

    const session = await this.getOrCreateSession(tool, signal)
    try {
      return await invoke(session)
    } catch (error) {
      if (signal?.aborted) throw error
      // Replay only when the connection itself is gone, which is the one case
      // where the call probably never reached the server. A timeout or a
      // JSON-RPC error means the server already saw the call: replaying it
      // would duplicate whatever side effect it performed before failing.
      if (!session.closed) throw error
      await this.invalidate(tool.id)
      return invoke(await this.getOrCreateSession(tool, signal))
    }
  }

  async invalidate(toolId: string): Promise<void> {
    this.connecting.delete(toolId)
    const existing = this.sessions.get(toolId)
    if (!existing) return
    this.sessions.delete(toolId)
    await existing.client.close().catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    this.connecting.clear()
    const all = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(all.map((session) => session.client.close()))
  }
}

export const mcpRuntimeManager = new McpRuntimeManager()
