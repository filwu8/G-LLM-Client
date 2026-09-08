/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { access, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkspaceProcess, type WorkspaceProcessOptions } from './workspaceProcess.ts'
import { applySandboxSnapshot, createSandboxSnapshot } from './workspaceSandboxFiles.ts'

export type SandboxPlatform = 'darwin' | 'linux' | 'win32'
export interface SandboxStatus { backend: string; available: boolean; detail: string }
export function sandboxBackend(platform: string = process.platform): string {
  return ({ darwin: 'Seatbelt', linux: 'Bubblewrap + seccomp', win32: 'AppContainer + Job Object' } as Record<string, string>)[platform] ?? 'Unsupported'
}
function resourcePath(name: string) {
  const packaged = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return packaged && !process.defaultApp ? resolve(packaged, 'resources', name) : fileURLToPath(new URL(`../../resources/${name}`, import.meta.url))
}
export async function sandboxStatus(): Promise<SandboxStatus> {
  const backend = sandboxBackend()
  try {
    if (process.platform === 'darwin') await access('/usr/bin/sandbox-exec', constants.X_OK)
    else if (process.platform === 'linux') {
      await access('/usr/bin/bwrap', constants.X_OK)
      if (!['x64', 'arm64'].includes(process.arch)) throw new Error('seccomp backend requires x64 or arm64')
    } else if (process.platform === 'win32') {
      await access(resourcePath('workspace-appcontainer.ps1'))
      await access(resourcePath('workspace-appcontainer.cs'))
    } else throw new Error('This OS has no supported native sandbox')
    return { backend, available: true, detail: 'Backend present; execution still requires a successful OS isolation check. No host fallback.' }
  } catch {
    return { backend, available: false, detail: process.platform === 'linux' ? 'Install bubblewrap (/usr/bin/bwrap); enable unprivileged user namespaces according to your system policy. x64/arm64 required. No host fallback.' : 'Native sandbox backend unavailable. No host fallback.' }
  }
}
const q = (path: string) => JSON.stringify(path)
export function seatbeltProfile(work: string, scratch: string, runtime: string, network: boolean) {
  // Default deny includes Mach IPC, Apple Events, launchd, keychain and Unix sockets.
  return `(version 1)
(deny default)
(allow process-fork process-exec)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow mach-lookup (global-name "com.apple.system.logger") (global-name "com.apple.logd"))
(allow file-read* (literal "/"))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* ${['/System', '/usr', '/bin', '/sbin', '/Library/Apple', '/Library/Frameworks/Python.framework', '/Library/Developer', '/Applications/Xcode.app/Contents/Developer', '/opt/homebrew', runtime, work, scratch].map(path => `(subpath ${q(path)})`).join(' ')})
(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal "/private/etc/localtime"))
(allow file-write* (subpath ${q(work)}) (subpath ${q(scratch)}) (literal "/dev/null"))
${network ? '(allow network-outbound (remote tcp "*:*"))\n(allow network-outbound (remote udp "*:*"))\n(allow network-outbound (literal "/private/var/run/mDNSResponder"))\n(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))\n(allow file-read* (subpath "/private/etc") (subpath "/private/var/run/resolv.conf"))\n(allow mach-lookup (global-name "com.apple.SystemConfiguration.configd") (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.mDNSResponder"))' : ''}
`
}
// Classic BPF seccomp filter: verify architecture, block host IPC sockets and dangerous
// process/namespace operations even when networking is enabled. bwrap sets no_new_privs.
export function linuxSeccomp(arch: string): Buffer {
  const arm = arch === 'arm64'
  if (!arm && arch !== 'x64') throw new Error('Unsupported seccomp architecture')
  const instructions: Array<[number, number, number, number]> = [
    [0x20, 0, 0, 4], [0x15, 1, 0, arm ? 0xc00000b7 : 0xc000003e], [0x06, 0, 0, 0x80000000],
    [0x20, 0, 0, 0]
  ]
  // x32 ABI syscall numbers must not bypass the x86_64 syscall checks.
  if (!arm) instructions.push([0x35, 0, 1, 0x40000000], [0x06, 0, 0, 0x50001])
  for (const syscall of arm ? [117, 97, 268, 270, 271, 104, 105, 106, 217, 218, 219, 265, 280, 282, 425, 426, 427] : [101, 272, 308, 310, 311, 155, 165, 166, 248, 249, 250, 298, 304, 321, 323, 425, 426, 427]) {
    instructions.push([0x15, 0, 1, syscall], [0x06, 0, 0, 0x50001])
  }
  // socket(AF_UNIX) can reach host daemons when the network namespace is shared.
  for (const syscall of arm ? [198, 199] : [41, 53]) {
    instructions.push([0x15, 0, 4, syscall], [0x20, 0, 0, 16], [0x15, 0, 1, 1], [0x06, 0, 0, 0x50001], [0x06, 0, 0, 0x7fff0000])
  }
  instructions.push([0x06, 0, 0, 0x7fff0000])
  const buffer = Buffer.alloc(instructions.length * 8)
  instructions.forEach(([code, jt, jf, k], index) => { buffer.writeUInt16LE(code, index * 8); buffer[index * 8 + 2] = jt; buffer[index * 8 + 3] = jf; buffer.writeUInt32LE(k, index * 8 + 4) })
  return buffer
}
export function bubblewrapArgs(work: string, scratch: string, executable: string, args: string[], cwd: string, network: boolean, runtimePaths: string[]) {
  return ['--die-with-parent', '--new-session', '--unshare-all', ...(network ? ['--share-net'] : []), '--cap-drop', 'ALL', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    ...runtimePaths.flatMap(path => ['--ro-bind', path, path]), '--bind', work, work, '--bind', scratch, scratch, '--chdir', cwd, '--seccomp', '3', '--', executable, ...args]
}
export async function runSandboxCommand(options: WorkspaceProcessOptions, root: string, network: boolean) {
  const status = await sandboxStatus()
  if (!status.available) throw new Error(status.detail)
  const snapshot = await createSandboxSnapshot(root)
  try {
    const { relative } = await import('node:path')
    const cwd = resolve(snapshot.work, relative(await realpath(root), options.cwd))
    await mkdir(cwd, { recursive: true })
    const env = { ...options.env, HOME: snapshot.scratch, TMPDIR: snapshot.scratch, TEMP: snapshot.scratch, TMP: snapshot.scratch }
    let result: Awaited<ReturnType<typeof runWorkspaceProcess>>
    if (process.platform === 'darwin') {
      const executable = await realpath(options.executable)
      if (!['/usr/', '/bin/', '/sbin/', '/opt/homebrew/', '/Library/Frameworks/Python.framework/', '/Library/Developer/', '/Applications/Xcode.app/Contents/Developer/'].some(prefix => executable.startsWith(prefix))) throw new Error('macOS sandbox requires a Python runtime installed under a standard system, Homebrew or Python.framework directory')
      const profile = resolve(snapshot.directory, 'policy.sb')
      await writeFile(profile, seatbeltProfile(snapshot.work, snapshot.scratch, dirname(executable), network), { mode: 0o600 })
      result = await runWorkspaceProcess({ ...options, executable: '/usr/bin/sandbox-exec', args: ['-f', profile, executable, ...options.args], cwd, env })
    } else if (process.platform === 'linux') {
      const paths: string[] = []
      for (const path of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/ld.so.cache', '/etc/ssl/certs', '/etc/ssl/openssl.cnf', ...(network ? ['/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf'] : [])]) {
        try { await access(path); paths.push(path) } catch { /* absent runtime path */ }
      }
      if (!options.executable.startsWith('/usr/') && !options.executable.startsWith('/bin/')) throw new Error('Sandbox requires a system Python installation under /usr; user-home interpreters are not exposed')
      const policy = resolve(snapshot.directory, 'seccomp.bpf')
      await writeFile(policy, linuxSeccomp(process.arch), { mode: 0o600 })
      result = await runWorkspaceProcess({ ...options, executable: '/usr/bin/bwrap', args: bubblewrapArgs(snapshot.work, snapshot.scratch, options.executable, options.args, cwd, network, paths), cwd, env, extraInputFile: policy })
    } else {
      // Only the trusted helper reads this config. Selected credentials remain in the
      // inherited clean environment, never in this file or command line.
      const config = resolve(snapshot.directory, 'launch.json')
      await writeFile(config, JSON.stringify({ executable: options.executable, args: options.args, cwd, work: snapshot.work, scratch: snapshot.scratch, network, timeoutMs: options.timeoutMs ?? 120000 }), { mode: 0o600 })
      result = await runWorkspaceProcess({ ...options, executable: resolve(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resourcePath('workspace-appcontainer.ps1'), '-Config', config], cwd, env })
    }
    options.signal?.throwIfAborted()
    if (result.exitCode === 0) await applySandboxSnapshot(snapshot)
    return { ...result, stderr: result.stderr + (result.exitCode !== 0 ? '\nSandbox execution failed; temporary workspace changes were not applied. No host fallback was attempted.' : '') }
  } finally { await rm(snapshot.directory, { recursive: true, force: true }) }
}
