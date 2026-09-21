/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { access, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { constants } from 'node:fs'
import { delimiter, dirname, isAbsolute, relative, resolve } from 'node:path'
import { normalizeEnvNames, selectWorkspaceEnvironment, redactWorkspaceSecrets } from './workspaceAgentPolicy.ts'
import { runSandboxCommand } from './workspaceSandbox.ts'
import { runWorkspaceProcess, type WorkspaceProcessOptions } from './workspaceProcess.ts'
import { windowsBatchScript } from './workspaceWindowsShell.ts'

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

const pythonAvailabilityByMode = new Map<string, Promise<boolean>>()

export function nativeExecutionLanguages(pythonAvailable: boolean): ('python' | 'shell')[] {
  return pythonAvailable ? ['python', 'shell'] : ['shell']
}

function windowsShellFailureGuidance(output: string): string {
  if (!/is not recognized as an internal or external command|不是内部或外部命令/i.test(output)) return ''
  return '\nWindows shell note: run_shell uses CMD batch syntax. POSIX commands such as head, grep, and sed are not built in. Use read_file/search_text, CMD commands such as type/findstr, or run_javascript, then continue the requested task.'
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
    : windows ? resolve(systemRoot, 'System32', 'cmd.exe') : '/bin/sh'
  const args = command.language === 'python' ? ['-I', '-X', 'utf8', '-u', '-c', command.code]
    : windows ? ['/d', '/s', '/c', command.code] : ['-c', command.code]
  const env: NodeJS.ProcessEnv = {
    PATH: [ ...(python ? [dirname(python)] : []), ...(windows ? [resolve(systemRoot, 'System32'), systemRoot] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) ].join(delimiter),
    HOME: command.cwd,
    LANG: 'en_US.UTF-8',
    // Windows requires LOCALAPPDATA when creating an AppContainer process.
    // Keep only OS runtime paths; never inherit the host's business environment.
    ...(windows ? { SystemRoot: systemRoot, windir: systemRoot, SystemDrive: systemRoot.slice(0, 2), LOCALAPPDATA: process.env.LOCALAPPDATA, PATHEXT: '.COM;.EXE;.BAT;.CMD', PSModulePath: resolve(systemRoot, 'System32/WindowsPowerShell/v1.0/Modules'), TEMP: process.env.TEMP, TMP: process.env.TMP } : { TMPDIR: process.env.TMPDIR || '/tmp' }),
    ...selected
  }
  const options = { ...execution, executable, args, cwd: command.cwd, env, signal }
  let result: Awaited<ReturnType<typeof runWorkspaceProcess>>
  if (windows && command.language === 'shell' && command.executionMode === 'host') {
    const temporary = await mkdtemp(resolve(tmpdir(), 'gllm-host-shell-'))
    try {
      const script = resolve(temporary, 'command.cmd')
      await writeFile(script, windowsBatchScript(command.code))
      result = await runWorkspaceProcess({ ...options, args: ['/d', '/s', '/c', `""${script}""`], windowsVerbatimArguments: true })
    } finally { await rm(temporary, { recursive: true, force: true }) }
  } else {
    result = command.executionMode === 'host' ? await runWorkspaceProcess(options) : await runSandboxCommand(options, command.root ?? command.cwd, command.sandboxNetwork === true)
  }
  const rawOutput = `Exit code: ${result.exitCode}\n${result.stdout}\n${result.stderr}${windows && command.language === 'shell' && result.exitCode !== 0 ? windowsShellFailureGuidance(`${result.stdout}\n${result.stderr}`) : ''}`
  return {
    exitCode: result.exitCode,
    output: redactWorkspaceSecrets(rawOutput, values)
  }
}

/**
 * Verify Python using the same boundary the agent will use. In particular,
 * finding python.exe on the host PATH is not enough for Windows AppContainer:
 * a per-user runtime may be unreadable from the restricted token.
 */
export function probeNativePython(settings: { executionMode?: 'sandbox' | 'host'; sandboxNetwork?: boolean } = {}): Promise<boolean> {
  const executionMode = settings.executionMode === 'host' ? 'host' : 'sandbox'
  const key = `${process.platform}:${executionMode}`
  const cached = pythonAvailabilityByMode.get(key)
  if (cached) return cached

  const probe = (async () => {
    let root: string | undefined
    try {
      root = await mkdtemp(resolve(tmpdir(), 'gllm-python-probe-'))
      const command = await prepareNativeCommand(root, 'run_python', { code: 'print("__GLLM_PYTHON_PROBE_OK__")' }, [], settings)
      const result = await runNativeCommand(command, {}, undefined, { timeoutMs: 10000, maxOutputBytes: 4096 })
      return result.exitCode === 0 && result.output.includes('__GLLM_PYTHON_PROBE_OK__')
    } catch {
      return false
    } finally {
      if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
  })()
  pythonAvailabilityByMode.set(key, probe)
  return probe
}
