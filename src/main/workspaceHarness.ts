/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * DeepSeek Harness integration.
 *
 * The full dsh dependency tree (Node >= 24.9 + ~600 packages) must not be
 * loaded into the Electron main process. Instead we spawn a dedicated Node 24
 * process running resources/harness-bridge.mjs, which drives the official
 * @deepseek-ai/dsh-sdk-client. This module owns that child and speaks a
 * line-delimited JSON protocol over stdio.
 */

export type HarnessApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled'

export interface HarnessRuntimeInfo {
  available: boolean
  nodePath?: string
  runtimeDir?: string
  bridgePath?: string
  nodeVersion?: string
  reason?: string
}

export interface HarnessInitOptions {
  provider: string
  model: string
  apiKey: string
  baseUrl?: string
  cwd: string
  dshHome: string
  profile?: string
  approvalRequests?: boolean
  maxTokens?: number
}

export interface HarnessRunResult {
  sessionId: string
  finalResponse: string
  finishReason: string | null
  eventCount: number
  notificationCount: number
}

export interface HarnessApprovalRequest {
  callId: string
  toolName?: string
  reason?: string
  raw: Record<string, unknown>
}

export interface HarnessUserQuestion {
  requestId: string
  raw: Record<string, unknown>
}

export interface HarnessCallbacks {
  onNotification?: (notification: { method: string; params: Record<string, unknown> }) => void
  onApprovalRequest?: (request: HarnessApprovalRequest) => void
  onUserQuestion?: (question: HarnessUserQuestion) => void
  onLog?: (level: string, message: string) => void
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const BRIDGE_FILE = 'harness-bridge.mjs'
const RUNTIME_DIR_NAME = 'harness-runtime'

/**
 * Electron environment hooks. Injected by the app at startup; defaults make
 * this module usable in plain Node (for tests and probe scripts) without
 * importing `electron`.
 */
interface HarnessEnvironment {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
}
let environment: HarnessEnvironment = {
  isPackaged: false,
  appPath: process.cwd(),
  resourcesPath: join(process.cwd(), 'resources')
}
export function configureHarnessEnvironment(next: Partial<HarnessEnvironment>): void {
  environment = { ...environment, ...next }
}

function dirExists(p: string): boolean {
  try { return statSync(p).isDirectory() } catch { return false }
}
function fileExists(p: string): boolean {
  try { return statSync(p).isFile() } catch { return false }
}

/** Locate the bridge script in dev and packaged layouts. */
export function harnessBridgePath(): string {
  if (environment.isPackaged) return join(environment.resourcesPath, 'resources', BRIDGE_FILE)
  return join(environment.appPath, 'resources', BRIDGE_FILE)
}

/**
 * Resolve the Node 24 + dsh runtime directory.
 * Priority:
 *   1) explicit override (setHarnessRuntimeOverride) — user/config supplied
 *   2) packaged extraResources <resources>/harness-runtime
 *   3) dev-only env DSH_GLLM_RUNTIME
 * A valid runtime has node_modules/@deepseek-ai/dsh-sdk-client and a node
 * executable (node.exe on Windows, node otherwise).
 */
let runtimeOverride: string | undefined
export function setHarnessRuntimeOverride(path: string | undefined): void {
  runtimeOverride = path?.trim() || undefined
}

function nodeExecutableIn(runtimeDir: string): string | undefined {
  const candidates = [
    join(runtimeDir, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    join(runtimeDir, 'node_modules', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    join(runtimeDir, process.platform === 'win32' ? 'node.exe' : 'bin', 'node')
  ]
  return candidates.find(fileExists)
}

export function inspectHarnessRuntime(): HarnessRuntimeInfo {
  const candidates: string[] = []
  if (runtimeOverride) candidates.push(runtimeOverride)
  if (environment.isPackaged) candidates.push(join(environment.resourcesPath, 'resources', RUNTIME_DIR_NAME))
  else candidates.push(join(environment.appPath, 'resources', RUNTIME_DIR_NAME))
  if (process.env.DSH_GLLM_RUNTIME) candidates.push(process.env.DSH_GLLM_RUNTIME)
  for (const runtimeDir of candidates) {
    if (!dirExists(runtimeDir)) continue
    const nodePath = nodeExecutableIn(runtimeDir)
    const sdkPath = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-sdk-client')
    if (!nodePath) return { available: false, runtimeDir, reason: `No Node executable found in ${runtimeDir}` }
    if (!dirExists(sdkPath)) return { available: false, runtimeDir, nodePath, reason: `dsh-sdk-client missing in ${runtimeDir}` }
    return { available: true, nodePath, runtimeDir, bridgePath: harnessBridgePath() }
  }
  return { available: false, reason: 'DeepSeek Harness runtime not installed' }
}

/** Probe a Node executable's version; returns e.g. "v24.22.3". */
export function probeNodeVersion(nodePath: string): string | undefined {
  try {
    const result = spawnSync(nodePath, ['--version'], { windowsHide: true, timeout: 10000, encoding: 'utf8' })
    return (result.stdout || '').trim() || undefined
  } catch {
    return undefined
  }
}

export function nodeMajorFromVersion(version: string): number {
  const match = version.match(/v?(\d+)/)
  return match ? Number(match[1]) : 0
}

export class HarnessBridge {
  private child?: ChildProcess
  private readonly pending = new Map<string, PendingRequest>()
  private readonly callbacks: HarnessCallbacks
  private buffer = ''
  private closing = false
  private initialized = false

  constructor(callbacks: HarnessCallbacks = {}) {
    this.callbacks = callbacks
  }

  get isInitialized(): boolean { return this.initialized }

  private ensureStarted(): { nodePath: string; runtimeDir: string; bridgePath: string } {
    if (this.child && !this.closing) {
      const info = inspectHarnessRuntime()
      if (!info.nodePath || !info.runtimeDir || !info.bridgePath) throw new Error(info.reason || 'Harness runtime unavailable')
      return { nodePath: info.nodePath, runtimeDir: info.runtimeDir, bridgePath: info.bridgePath }
    }
    const info = inspectHarnessRuntime()
    if (!info.available || !info.nodePath || !info.runtimeDir || !info.bridgePath) {
      throw new Error(info.reason || 'DeepSeek Harness runtime is not installed')
    }
    if (!fileExists(info.bridgePath)) throw new Error(`Harness bridge script missing: ${info.bridgePath}`)

    const child = spawn(info.nodePath, [info.bridgePath], {
      cwd: info.runtimeDir,
      env: { ...process.env, DSH_BRIDGE_RUNTIME: info.runtimeDir },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    this.closing = false
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => this.callbacks.onLog?.('error', String(chunk).slice(0, 2000)))
    child.once('error', (error) => this.failAll(error))
    child.once('exit', (code, signal) => {
      this.failAll(new Error(`Harness bridge exited (code=${code}, signal=${signal ?? 'none'})`))
      this.child = undefined
      this.initialized = false
    })
    return { nodePath: info.nodePath, runtimeDir: info.runtimeDir, bridgePath: info.bridgePath }
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>
    try { message = JSON.parse(line) } catch { return }
    if (message.event === 'notification') {
      this.callbacks.onNotification?.(message.notification as { method: string; params: Record<string, unknown> })
      return
    }
    if (message.event === 'approval_request') {
      this.callbacks.onApprovalRequest?.({
        callId: String(message.callId || ''),
        toolName: typeof (message.params as Record<string, unknown>)?.toolName === 'string' ? String((message.params as Record<string, unknown>).toolName) : undefined,
        reason: typeof (message.params as Record<string, unknown>)?.reason === 'string' ? String((message.params as Record<string, unknown>).reason) : undefined,
        raw: (message.params as Record<string, unknown>) || {}
      })
      return
    }
    if (message.event === 'user_question') {
      this.callbacks.onUserQuestion?.({ requestId: String(message.requestId || ''), raw: (message.params as Record<string, unknown>) || {} })
      return
    }
    if (message.event === 'log') {
      this.callbacks.onLog?.(String(message.level || 'info'), String(message.message || ''))
      return
    }
    const id = typeof message.id === 'string' ? message.id : ''
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if (message.ok === true) pending.resolve(message.result)
    else {
      const error = (message.error as Record<string, unknown>) || {}
      pending.reject(new Error(String(error.message || 'Harness bridge error')))
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private request<T>(method: string, params: Record<string, unknown>, timeoutMs = 900000): Promise<T> {
    this.ensureStarted()
    if (!this.child?.stdin?.writable) throw new Error('Harness bridge stdin is not writable')
    const id = randomUUID()
    return new Promise<T>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Harness ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolvePromise(value as T) },
        reject: (error) => { clearTimeout(timer); reject(error) }
      })
      this.child!.stdin!.write(JSON.stringify({ id, method, params }) + '\n', (error) => {
        if (error) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }

  async init(options: HarnessInitOptions): Promise<{ serverInfo?: unknown; alreadyInitialized?: boolean }> {
    const result = await this.request<{ serverInfo?: unknown; alreadyInitialized?: boolean }>('init', { ...options }, 120000)
    this.initialized = true
    return result
  }

  async run(prompt: string, sessionId?: string): Promise<HarnessRunResult> {
    return await this.request<HarnessRunResult>('run', { prompt, ...(sessionId ? { sessionId } : {}) })
  }

  async answerApproval(callId: string, outcome: HarnessApprovalOutcome): Promise<void> {
    await this.request<void>('approval', { callId, outcome }, 30000)
  }

  async answerUserQuestion(requestId: string, answers?: Array<{ id: string; selected: string[]; custom?: string }>, cancelled = false): Promise<void> {
    await this.request<void>('userQuestion', { requestId, answers, cancelled }, 30000)
  }

  async status(): Promise<Record<string, unknown>> {
    return await this.request<Record<string, unknown>>('status', {}, 30000)
  }

  async close(): Promise<void> {
    if (!this.child || this.closing) return
    this.closing = true
    try {
      await this.request<void>('close', {}, 10000)
    } catch {
      // Best effort; the bridge self-exits on close.
    }
    const child = this.child
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } }, 5000)
    await new Promise<void>((resolvePromise) => {
      if (child.exitCode !== null || child.signalCode !== null) { clearTimeout(timer); resolvePromise(); return }
      child.once('exit', () => { clearTimeout(timer); resolvePromise() })
    })
    this.child = undefined
    this.initialized = false
    this.closing = false
  }
}
