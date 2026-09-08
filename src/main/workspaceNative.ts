/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, dirname, isAbsolute, relative, resolve } from 'node:path'
import { normalizeEnvNames, selectWorkspaceEnvironment, redactWorkspaceSecrets } from './workspaceAgentPolicy.ts'
import { runSandboxCommand } from './workspaceSandbox.ts'
import { runWorkspaceProcess, type WorkspaceProcessOptions } from './workspaceProcess.ts'

export interface NativeCommand {
  language: 'python' | 'shell'
  code: string
  cwd: string
  envNames: string[]
  root?: string
  executionMode?: 'sandbox' | 'host'
  sandboxNetwork?: boolean
}

export async function prepareNativeCommand(root: string, tool: string, args: Record<string, unknown>, allowedEnvNames: unknown, settings: { executionMode?: 'sandbox' | 'host'; sandboxNetwork?: boolean } = {}): Promise<NativeCommand> {
  if (tool !== 'run_python' && tool !== 'run_shell') throw new Error('Unknown native execution tool')
  const code = String(args.code ?? '')
  if (!code.trim() || Buffer.byteLength(code) > 32_000) throw new Error('Code must contain 1–32000 bytes')
  const requestedCwd = String(args.cwd ?? '.')
  if (isAbsolute(requestedCwd)) throw new Error('cwd must be relative to the workspace')
  const rootReal = await realpath(root)
  const cwd = await realpath(resolve(rootReal, requestedCwd))
  const diff = relative(rootReal, cwd)
  if (diff.startsWith('..') || isAbsolute(diff) || !(await stat(cwd)).isDirectory()) throw new Error('cwd must be a directory inside the workspace')
  const envNames = normalizeEnvNames(args.envNames)
  if (args.envNames !== undefined && (!Array.isArray(args.envNames) || envNames.length !== args.envNames.length)) throw new Error('Invalid environment variable names')
  const allowed = new Set(normalizeEnvNames(allowedEnvNames))
  if (envNames.some((name) => !allowed.has(name))) throw new Error('Requested environment variables have not been enabled in Agent settings')
  return { language: tool === 'run_python' ? 'python' : 'shell', code, cwd, envNames, root: rootReal, executionMode: settings.executionMode === 'host' ? 'host' : 'sandbox', sandboxNetwork: settings.sandboxNetwork === true }
}

async function findPython(): Promise<string> {
  const directories = [...(process.platform === 'linux' ? ['/usr/bin'] : []), '/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(delimiter), '/usr/bin']
  for (const directory of directories.filter(isAbsolute)) {
    for (const name of process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3']) {
      const candidate = resolve(directory, name)
      try {
        await access(candidate, constants.X_OK)
        if ((await stat(candidate)).isFile()) return candidate
      } catch { /* try next installation */ }
    }
  }
  throw new Error('Python 3 was not found. Install Python 3 and restart G-LLM Client.')
}

export async function runNativeCommand(command: NativeCommand, values: Record<string, string>, signal?: AbortSignal, execution: Pick<WorkspaceProcessOptions, 'onOutput' | 'timeoutMs' | 'maxOutputBytes' | 'outputOverflow'> = {}) {
  signal?.throwIfAborted()
  const selected = selectWorkspaceEnvironment(values, command.envNames)
  const windows = process.platform === 'win32'
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const python = command.language === 'python' ? await findPython() : await findPython().catch(() => undefined)
  const executable = command.language === 'python' ? python!
    : windows ? resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/bin/sh'
  const args = command.language === 'python' ? ['-I', '-u', '-c', command.code]
    : windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command.code] : ['-c', command.code]
  const env: NodeJS.ProcessEnv = {
    PATH: [ ...(python ? [dirname(python)] : []), ...(windows ? [resolve(systemRoot, 'System32'), systemRoot] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) ].join(delimiter),
    HOME: command.cwd,
    LANG: 'en_US.UTF-8',
    ...(windows ? { SystemRoot: systemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP } : { TMPDIR: process.env.TMPDIR || '/tmp' }),
    ...selected
  }
  const options = { ...execution, executable, args, cwd: command.cwd, env, signal }
  const result = command.executionMode === 'host' ? await runWorkspaceProcess(options) : await runSandboxCommand(options, command.root ?? command.cwd, command.sandboxNetwork === true)
  return {
    exitCode: result.exitCode,
    output: redactWorkspaceSecrets(`Exit code: ${result.exitCode}\n${result.stdout}\n${result.stderr}`, values)
  }
}
