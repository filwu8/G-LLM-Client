/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { redactWorkspaceSecrets } from './workspaceAgentPolicy.ts'
import { integerOption, safeTextEnd } from './workspaceOutputStore.ts'
import type { WorkspaceFileMutation } from './workspaceArtifacts.ts'

type Stream = 'stdout' | 'stderr'
export type JobResult = { output: string; exitCode: number } & WorkspaceFileMutation
export type JobRunner = (signal: AbortSignal, output: (stream: Stream, chunk: Buffer) => void) => Promise<JobResult>
interface Job {
  id: string; status: 'running' | 'completed' | 'failed'; controller: AbortController; done: Promise<void>
  raw: Record<Stream, string>; decoder: Record<Stream, StringDecoder>; cursor: Record<Stream, number>
  result?: JobResult; error?: string; collected: boolean; bytes: number; truncated: boolean
}
const LOG_LIMIT = 1024 * 1024
/** Per-run jobs. Never publish a trailing prefix of a secret across chunk boundaries. */
export class WorkspaceJobs {
  private jobs = new Map<string, Job>()
  private values: Record<string, string> = {}
  configure(values: Record<string, string>) { this.values = { ...values } }
  get busy() { return [...this.jobs.values()].some(job => job.status === 'running') }
  get pending() { return [...this.jobs.values()].some(job => !job.collected) }
  list() { return [...this.jobs.values()].map(({ id, status, collected, truncated }) => ({ id, status, collected, truncated })) }
  start(run: JobRunner, signal?: AbortSignal) {
    if (this.busy) throw new Error('Wait for or stop the active job before starting another command')
    if (this.jobs.size >= 16) throw new Error('The per-run job limit (16) has been reached')
    signal?.throwIfAborted()
    const job: Job = { id: randomUUID(), status: 'running', controller: new AbortController(), done: Promise.resolve(), raw: { stdout: '', stderr: '' }, decoder: { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }, cursor: { stdout: 0, stderr: 0 }, collected: false, bytes: 0, truncated: false }
    this.jobs.set(job.id, job)
    const combined = signal ? AbortSignal.any([signal, job.controller.signal]) : job.controller.signal
    job.done = Promise.resolve().then(() => run(combined, (stream, chunk) => {
      const available = Math.max(0, LOG_LIMIT - job.bytes)
      job.bytes += chunk.length
      if (chunk.length > available) job.truncated = true
      job.raw[stream] += job.decoder[stream].write(chunk.subarray(0, available))
    })).then(result => {
      job.result = { ...result, output: redactWorkspaceSecrets(result.output, this.values) }
      job.status = result.exitCode === 0 ? 'completed' : 'failed'
    }, error => {
      job.error = redactWorkspaceSecrets(error instanceof Error ? error.message : String(error), this.values)
      job.status = 'failed'
    }).finally(() => {
      // Discard an unfinished UTF-8 suffix on exit/truncation. Appending a replacement
      // character could turn a withheld secret prefix into apparently safe text.
      for (const stream of ['stdout', 'stderr'] as const) job.decoder[stream].end()
    })
    return JSON.stringify({ id: job.id, status: job.status, next: { tool: 'job_output', id: job.id, waitMs: 30000 }, logLimitBytes: LOG_LIMIT })
  }
  private get(id: unknown) {
    const job = this.jobs.get(String(id ?? ''))
    if (!job) throw new Error('Job not found in this run')
    return job
  }
  private safeLog(job: Job, stream: Stream) {
    const raw = job.raw[stream], secrets = [...new Set(Object.values(this.values))].filter(Boolean).sort((a, b) => b.length - a.length)
    let index = 0, result = ''
    while (index < raw.length) {
      let matched = false
      for (const secret of secrets) {
        if (raw.length - index < secret.length && secret.startsWith(raw.slice(index))) return result
        if (raw.startsWith(secret, index)) { result += '[REDACTED]'; index += secret.length; matched = true; break }
      }
      if (!matched) { result += raw[index]; index++ }
    }
    return result
  }

  async read(args: Record<string, unknown>, signal?: AbortSignal): Promise<{ output: string } & Partial<JobResult>> {
    const job = this.get(args.id)
    const waitMs = integerOption(args.waitMs, 0, 0, 30000)
    if (job.status === 'running' && waitMs) {
      await new Promise<void>((resolve, reject) => {
        const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve() }
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new DOMException('Execution cancelled', 'AbortError')) }
        const timer = setTimeout(finish, waitMs)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        void job.done.then(finish)
      })
    }
    signal?.throwIfAborted()
    if (args.tail !== undefined && typeof args.tail !== 'boolean') throw new Error('tail must be boolean')
    const output: Record<Stream, string> = { stdout: '', stderr: '' }
    let more = false, skippedCharacters = 0
    for (const stream of ['stdout', 'stderr'] as const) {
      const text = this.safeLog(job, stream), previous = job.cursor[stream]
      let start = args.tail ? Math.max(previous, text.length - 3000) : previous
      if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start])) start++
      skippedCharacters += start - previous
      const end = safeTextEnd(text, Math.min(text.length, start + 3000))
      output[stream] = text.slice(start, end); job.cursor[stream] = end
      more ||= end < text.length
    }
    const collect = job.status !== 'running' && !job.collected
    if (collect) job.collected = true
    return {
      ...(collect ? job.result : {}),
      output: JSON.stringify({ id: job.id, status: job.status, ...output, more, skippedCharacters, truncated: job.truncated, error: job.error, exitCode: job.result?.exitCode, ...(collect ? { result: job.result?.output } : {}), next: job.status === 'running' || more ? { tool: 'job_output', id: job.id, waitMs: job.status === 'running' ? 30000 : 0 } : null })
    }
  }
  async stop(id: unknown) { const job = this.get(id); job.controller.abort(); await job.done; return this.read({ id }) }
  async dispose() {
    for (const job of this.jobs.values()) job.controller.abort()
    await Promise.all([...this.jobs.values()].map(job => job.done))
    this.jobs.clear(); this.values = {}
  }
}
