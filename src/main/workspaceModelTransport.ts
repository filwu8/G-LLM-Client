/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */

export interface WorkspaceModelRequestIdentity {
  runId: string
  requestId: string
  attemptId: string
}

export type WorkspaceModelFailurePhase = 'connection_timeout' | 'connection_error' | 'first_byte_timeout' | 'stream_idle_timeout' | 'total_timeout' | 'stream_interrupted'

export interface WorkspaceModelTimeouts {
  connectionMs: number
  firstByteMs: number
  streamIdleMs: number
  totalMs: number
}

export const WORKSPACE_MODEL_TIMEOUTS: WorkspaceModelTimeouts = {
  connectionMs: 45_000,
  firstByteMs: 120_000,
  streamIdleMs: 120_000,
  totalMs: 10 * 60_000
}

export class WorkspaceModelTransportError extends Error {
  readonly phase: WorkspaceModelFailurePhase
  readonly identity: WorkspaceModelRequestIdentity
  readonly upstreamState: 'unknown' = 'unknown'

  constructor(phase: WorkspaceModelFailurePhase, identity: WorkspaceModelRequestIdentity, cause?: unknown) {
    const labels: Record<WorkspaceModelFailurePhase, string> = {
      connection_timeout: 'Timed out connecting to the model service or waiting for response headers',
      connection_error: 'Could not connect to the model service or receive response headers',
      first_byte_timeout: 'The model service returned headers but no response bytes before the first-byte timeout',
      stream_idle_timeout: 'The model stream had no transport bytes or SSE heartbeat before the idle timeout',
      total_timeout: 'The model response exceeded the total request time limit',
      stream_interrupted: 'The model response stream was interrupted before completion'
    }
    super(`${labels[phase]}; upstream execution state is unknown and the request was not replayed (run=${identity.runId}, request=${identity.requestId}, attempt=${identity.attemptId})`, { cause })
    this.name = 'WorkspaceModelTransportError'
    this.phase = phase
    this.identity = identity
  }
}

export interface WorkspaceModelFetchOptions {
  url: string
  apiKey?: string
  body: Record<string, unknown>
  identity: WorkspaceModelRequestIdentity
  signal?: AbortSignal
  connectionTimeoutMs?: number
  fetcher?: typeof fetch
}

export function workspaceModelRequestHeaders(apiKey: string | undefined, identity: WorkspaceModelRequestIdentity): HeadersInit {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    'Content-Type': 'application/json',
    'X-G-LLM-Run-ID': identity.runId,
    'X-G-LLM-Request-ID': identity.requestId,
    'X-G-LLM-Attempt-ID': identity.attemptId
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'))
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (hasError: boolean, error?: unknown, value?: T) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', handleAbort)
      if (hasError) rejectPromise(error)
      else resolvePromise(value!)
    }
    const handleAbort = () => finish(true, signal.reason ?? new DOMException('Request aborted', 'AbortError'))
    signal.addEventListener('abort', handleAbort, { once: true })
    promise.then((value) => finish(false, undefined, value), (error) => finish(true, error))
  })
}

export async function fetchWorkspaceModelResponse(options: WorkspaceModelFetchOptions): Promise<Response> {
  const fetcher = options.fetcher ?? fetch
  const connectionController = new AbortController()
  const timeout = setTimeout(() => connectionController.abort(new DOMException('Connection timed out', 'TimeoutError')), options.connectionTimeoutMs ?? WORKSPACE_MODEL_TIMEOUTS.connectionMs)
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, connectionController.signal])
    : connectionController.signal
  try {
    return await raceWithAbort(fetcher(options.url, {
        method: 'POST',
        headers: workspaceModelRequestHeaders(options.apiKey, options.identity),
        body: JSON.stringify(options.body),
        signal: requestSignal
      }), requestSignal)
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason ?? error
    if (connectionController.signal.aborted) throw new WorkspaceModelTransportError('connection_timeout', options.identity, error)
    throw new WorkspaceModelTransportError('connection_error', options.identity, error)
  } finally {
    clearTimeout(timeout)
  }
}

export async function withWorkspaceModelTotalTimeout<T>(
  identity: WorkspaceModelRequestIdentity,
  signal: AbortSignal | undefined,
  action: (requestSignal: AbortSignal) => Promise<T>,
  timeoutMs = WORKSPACE_MODEL_TIMEOUTS.totalMs
): Promise<T> {
  const totalController = new AbortController()
  const timeout = setTimeout(() => totalController.abort(new DOMException('Total model request time limit reached', 'TimeoutError')), timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, totalController.signal]) : totalController.signal
  try {
    return await raceWithAbort(action(requestSignal), requestSignal)
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    if (totalController.signal.aborted) throw new WorkspaceModelTransportError('total_timeout', identity, error)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function readWorkspaceModelChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  identity: WorkspaceModelRequestIdentity,
  phase: 'first_byte_timeout' | 'stream_idle_timeout',
  timeoutMs: number
): Promise<ReadableStreamReadResult<Uint8Array>> {
  signal?.throwIfAborted()
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (hasError: boolean, error?: unknown, value?: ReadableStreamReadResult<Uint8Array>) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
      if (hasError) rejectPromise(error)
      else resolvePromise(value!)
    }
    const timeout = setTimeout(() => {
      void reader.cancel().catch(() => undefined)
      finish(true, new WorkspaceModelTransportError(phase, identity))
    }, timeoutMs)
    const handleAbort = () => {
      void reader.cancel().catch(() => undefined)
      finish(true, signal?.reason ?? new DOMException('Request aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
    reader.read().then(
      (value) => finish(false, undefined, value),
      (error) => finish(true, new WorkspaceModelTransportError('stream_interrupted', identity, error))
    )
  })
}
