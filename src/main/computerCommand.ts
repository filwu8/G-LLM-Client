/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { homedir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { computerCode } from './desktopToolPolicy.ts'
import { normalizeEnvNames, selectWorkspaceEnvironment, redactWorkspaceSecrets } from './workspaceAgentPolicy.ts'
import { runWorkspaceProcess } from './workspaceProcess.ts'

// This is a separate host capability. Never turn a sandbox command into a host command.
export async function runComputerCommand(root: string, args: Record<string, unknown>, allowedNames: unknown, values: Record<string, string>, signal?: AbortSignal) {
  const code = computerCode(args)
  const names = normalizeEnvNames(args.envNames)
  if (args.envNames !== undefined && (!Array.isArray(args.envNames) || names.length !== args.envNames.length)) throw new Error('Invalid variable names')
  const allowed = new Set(normalizeEnvNames(allowedNames))
  if (names.some(name => !allowed.has(name))) throw new Error('Requested variables are not enabled in Agent settings')
  const windows = process.platform === 'win32'
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const executable = windows ? resolve(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/sh'
  const command = `$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n$global:LASTEXITCODE = 0\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\n${code}\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
  const env: NodeJS.ProcessEnv = {
    PATH: [...new Set([...(windows ? [] : ['/opt/homebrew/bin', '/usr/local/bin']), ...(process.env.PATH || '').split(delimiter).filter(Boolean), ...(windows ? [resolve(systemRoot, 'System32')] : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'])])].join(delimiter),
    HOME: homedir(), USERPROFILE: homedir(), LANG: 'en_US.UTF-8',
    USER: process.env.USER, LOGNAME: process.env.LOGNAME, USERNAME: process.env.USERNAME,
    ...(process.platform === 'linux' ? { DISPLAY: process.env.DISPLAY, WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS } : {}),
    ...(windows ? { SystemRoot: systemRoot, windir: systemRoot, SystemDrive: systemRoot.slice(0, 2), ComSpec: resolve(systemRoot, 'System32/cmd.exe'), PATHEXT: '.COM;.EXE;.BAT;.CMD', TEMP: process.env.TEMP, TMP: process.env.TMP, APPDATA: process.env.APPDATA, LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles, 'ProgramFiles(x86)': process.env['ProgramFiles(x86)'], PSModulePath: resolve(systemRoot, 'System32/WindowsPowerShell/v1.0/Modules') } : { TMPDIR: process.env.TMPDIR || '/tmp' }),
    ...selectWorkspaceEnvironment(values, names)
  }
  const result = await runWorkspaceProcess({ executable, args: windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')] : ['-c', code], env, cwd: root, signal, timeoutMs: 120_000 })
  const permissionHint = process.platform === 'darwin' && result.exitCode !== 0 && /not authorized to send apple events|-1743|assistive access|-25211/i.test(result.stderr)
    ? '\nmacOS blocked application automation. The user must grant Automation and, for UI scripting, Accessibility permission in System Settings > Privacy & Security. Agent settings can request/recheck Accessibility permission. Do not retry through another tool to bypass the OS decision.' : ''
  return { exitCode: result.exitCode, output: redactWorkspaceSecrets(`Exit code: ${result.exitCode}\n${result.stdout}\n${result.stderr}${permissionHint}`, values) }
}
