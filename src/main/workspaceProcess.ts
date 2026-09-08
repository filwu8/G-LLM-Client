/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'

export interface WorkspaceProcessOptions {
  executable: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
  timeoutMs?: number
  maxOutputBytes?: number
  onOutput?: (stream: 'stdout' | 'stderr', chunk: Buffer) => void
  outputOverflow?: 'truncate' | 'stop'
  extraInputFile?: string
  windowsVerbatimArguments?: boolean
}

// A managed HOST process, not a sandbox. Descendants which deliberately detach can escape
// a process group. Host execution is separately enabled; approval follows the conversation mode.
export function runWorkspaceProcess(options: WorkspaceProcessOptions): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  options.signal?.throwIfAborted()
  return new Promise((resolvePromise, reject) => {
    const inputFd = options.extraInputFile ? openSync(options.extraInputFile, 'r') : undefined
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd, env: options.env, windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', ...(inputFd === undefined ? [] : [inputFd])]
    })
    if (inputFd !== undefined) closeSync(inputFd)
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let failure: Error | undefined
    let finished = false
    const killTree = () => {
      if (!child.pid) return
      if (process.platform === 'win32') {
        const killer = spawn(resolve(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => child.kill('SIGKILL'))
      } else {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* process group already exited */ }
      }
    }
    const stop = (error: Error) => { failure ??= error; killTree() }
    const abort = () => stop(new DOMException('Execution cancelled', 'AbortError'))
    const timer = setTimeout(() => stop(new Error('Execution timed out')), options.timeoutMs ?? 120_000)
    const collect = (stream: 'stdout' | 'stderr', chunks: Buffer[], chunk: Buffer) => {
      const available = Math.max(0, (options.maxOutputBytes ?? 128_000) - bytes)
      bytes += chunk.length
      const retained = chunk.subarray(0, available)
      if (retained.length) {
        chunks.push(retained)
        try { options.onOutput?.(stream, retained) } catch (error) { stop(error instanceof Error ? error : new Error('Output callback failed')) }
      }
      if (chunk.length > available && options.outputOverflow !== 'truncate') stop(new Error('Execution stopped: output exceeded the limit'))
    }
    child.stdout!.on('data', (chunk: Buffer) => collect('stdout', stdout, chunk))
    child.stderr!.on('data', (chunk: Buffer) => collect('stderr', stderr, chunk))
    const finish = (error?: Error, exitCode = -1) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (error || failure) reject(error ?? failure)
      else resolvePromise({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode })
    }
    child.once('error', (error) => finish(error))
    child.once('exit', () => killTree())
    child.once('close', (code, signal) => {
      if (signal) stderr.push(Buffer.from(`\nProcess terminated by ${signal}`))
      finish(undefined, code ?? -1)
    })
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
  })
}
