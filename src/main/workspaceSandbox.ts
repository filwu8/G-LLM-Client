/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runWorkspaceProcess, type WorkspaceProcessOptions } from './workspaceProcess.ts'
import { applySandboxSnapshot, createSandboxSnapshot } from './workspaceSandboxFiles.ts'
import { windowsBatchScript } from './workspaceWindowsShell.ts'

export type SandboxPlatform = 'darwin' | 'linux' | 'win32'
export interface SandboxStatus {
  backend: string
  available: boolean
  detail: string
  /**
   * Why the backend cannot be used; absent when available. `missing` means the
   * launcher was not shipped on this system, `unverified` means it is present but
   * a sandboxed child process could not actually start, `timeout` means the check
   * itself never finished, so the host is not known to be broken.
   */
  reason?: 'missing' | 'unverified' | 'timeout'
}
export function sandboxBackend(platform: string = process.platform): string {
  return ({ darwin: 'Seatbelt', linux: 'Bubblewrap + seccomp', win32: 'AppContainer + Job Object' } as Record<string, string>)[platform] ?? 'Unsupported'
}
function resourcePath(name: string) {
  const packaged = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return packaged && !process.defaultApp ? resolve(packaged, 'resources', name) : fileURLToPath(new URL(`../../resources/${name}`, import.meta.url))
}
/**
 * OS runtime environment a sandboxed child needs. Shared with the pre-flight so a
 * probe can never pass under conditions the real command would not have. Carries
 * no business secrets: callers merge in explicitly selected variables.
 */
export function sandboxRuntimeEnv(pythonDirectory?: string): NodeJS.ProcessEnv {
  const windows = process.platform === 'win32'
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return {
    PATH: [...(pythonDirectory ? [pythonDirectory] : []), ...(windows ? [resolve(systemRoot, 'System32'), systemRoot] : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(delimiter),
    LANG: 'en_US.UTF-8',
    ...(windows
      // Windows requires LOCALAPPDATA when creating an AppContainer process.
      ? { SystemRoot: systemRoot, windir: systemRoot, SystemDrive: systemRoot.slice(0, 2), LOCALAPPDATA: process.env.LOCALAPPDATA, PATHEXT: '.COM;.EXE;.BAT;.CMD', PSModulePath: resolve(systemRoot, 'System32/WindowsPowerShell/v1.0/Modules'), TEMP: process.env.TEMP, TMP: process.env.TMP }
      : { TMPDIR: process.env.TMPDIR || '/tmp' })
  }
}
async function requireLauncher(): Promise<void> {
  if (process.platform === 'darwin') await access('/usr/bin/sandbox-exec', constants.X_OK)
  else if (process.platform === 'linux') {
    await access('/usr/bin/bwrap', constants.X_OK)
    if (!['x64', 'arm64'].includes(process.arch)) throw new Error('seccomp backend requires x64 or arm64')
  } else if (process.platform === 'win32') {
    await access(resourcePath('workspace-appcontainer.ps1'))
    await access(resourcePath('workspace-appcontainer.cs'))
  } else throw new Error('This OS has no supported native sandbox')
}
const PREFLIGHT_MARKER = '__GLLM_SANDBOX_PREFLIGHT_OK__'
const PREFLIGHT_TIMEOUT_MS = 30_000
interface SandboxProbeResult {
  ok: boolean
  failure?: string
  /**
   * A check that never finished is not evidence that the host is broken: the first
   * launch on a machine pays for PowerShell startup and an antivirus scan of the
   * generated bootstrap, which can exceed the budget on a slow or busy host.
   */
  timedOut?: boolean
}
/** Test seam: lets a regression test drive the timeout branch without waiting 30s. */
function preflightTimeoutMs(): number {
  const override = Number(process.env.GLLM_SANDBOX_PROBE_TIMEOUT_MS)
  return Number.isFinite(override) && override > 0 ? override : PREFLIGHT_TIMEOUT_MS
}
async function probeSandboxLaunch(): Promise<SandboxProbeResult> {
  // Answers with the failure detail, or ok when a sandboxed child really ran.
  // It goes through executeSandboxed, never runSandboxCommand, because this probe
  // is what runSandboxCommand's own gate depends on.
  let root: string | undefined
  const budget = preflightTimeoutMs()
  const startedAt = Date.now()
  const expired = () => Date.now() - startedAt >= budget
  try {
    root = await mkdtemp(resolve(tmpdir(), 'gllm-sandbox-preflight-'))
    const windows = process.platform === 'win32'
    const command = `echo ${PREFLIGHT_MARKER}`
    const result = await executeSandboxed({
      executable: windows ? resolve(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe') : '/bin/sh',
      args: windows ? ['/d', '/s', '/c', command] : ['-c', command],
      cwd: root,
      env: { ...sandboxRuntimeEnv(), HOME: root },
      timeoutMs: budget
    }, root, false)
    if (result.exitCode === 0 && result.stdout.includes(PREFLIGHT_MARKER)) return { ok: true }
    // executeSandboxed appends a note about the user's workspace not being applied.
    // The probe never had workspace changes, so that line would misdescribe it.
    const stderr = result.stderr.replace(/Sandbox execution failed; temporary workspace changes were not applied\. No host fallback was attempted\./g, '').trim().slice(0, 300)
    const failure = `the probe exited with code ${result.exitCode}${stderr ? `: ${stderr}` : ''}`
    if (!expired()) return { ok: false, failure }
    // On Windows the helper clamps its own wait to one second and then reads a stale
    // exit code, so an answer that arrives after the budget means the check never
    // completed: that is a timeout, not a verdict about the host.
    return { ok: false, failure: `the check returned no result within ${budget}ms; ${failure} after ${Date.now() - startedAt}ms`, timedOut: true }
  } catch (error) {
    const message = (error as Error).message
    return { ok: false, failure: message, timedOut: message === 'Execution timed out' || expired() }
  } finally {
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
}
let sandboxStatusProbe: Promise<SandboxStatus> | undefined
async function resolveSandboxStatus(): Promise<SandboxStatus> {
  const backend = sandboxBackend()
  try {
    await requireLauncher()
  } catch {
    return {
      backend,
      available: false,
      reason: 'missing',
      detail: process.platform === 'linux' ? 'Install bubblewrap (/usr/bin/bwrap); enable unprivileged user namespaces according to your system policy. x64/arm64 required. No host fallback.' : 'Native sandbox backend unavailable. No host fallback.'
    }
  }
  const probe = await probeSandboxLaunch()
  if (probe.ok) return { backend, available: true, detail: 'Backend present and a sandboxed child process started successfully. No host fallback.' }
  // The launcher ships with the app, so a failed launch is a host limitation, not
  // a missing install. Distinguishing the two is the whole point: a backend that
  // cannot start a child used to look exactly like the user's command failing with
  // exit code 1, and nothing in the UI said the sandbox was the problem.
  if (probe.timedOut) {
    // Reporting this as a broken backend would be a lie the user cannot argue with:
    // the check, not the sandbox, ran out of time. Say so and retry next time.
    return {
      backend,
      available: false,
      reason: 'timeout',
      detail: `${backend} is present but could not verify a sandboxed process (${probe.failure}), so whether one can start here is unknown. Commands are blocked rather than run without isolation; the check runs again on the next command.`
    }
  }
  return {
    backend,
    available: false,
    reason: 'unverified',
    detail: `${backend} is present but could not start a sandboxed process on this system (${probe.failure}). Commands are blocked rather than run without isolation.`
  }
}
/**
 * Whether the native sandbox can be used. Runs one real probe per process instead
 * of trusting that the launcher files exist: presence on disk says nothing about
 * whether the OS will accept a sandboxed child. Cached because a settled answer is
 * stable for the process lifetime and the probe is expensive on Windows.
 */
export function sandboxStatus(): Promise<SandboxStatus> {
  return (sandboxStatusProbe ??= resolveSandboxStatus().then((status) => {
    // An inconclusive check must not be cached: one slow first launch would then
    // block every command for the rest of the process with no way back but a restart.
    if (status.reason === 'timeout') sandboxStatusProbe = undefined
    return status
  }))
}
/** Clear the cached probe so the next call re-checks. Tests and manual retry. */
export function resetSandboxStatus(): void {
  sandboxStatusProbe = undefined
}
const q = (path: string) => JSON.stringify(path)
const powershellLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`
export function windowsAppContainerPowerShellArgs(helper: string, config: string): string[] {
  const bootstrap = [
    '$ProgressPreference = "SilentlyContinue"',
    '$ErrorActionPreference = "Stop"',
    '$utf8 = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = $utf8',
    '[Console]::InputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    '$stdout = [System.IO.StreamWriter]::new([Console]::OpenStandardOutput(), $utf8)',
    '$stderr = [System.IO.StreamWriter]::new([Console]::OpenStandardError(), $utf8)',
    '$stdout.AutoFlush = $true',
    '$stderr.AutoFlush = $true',
    '[Console]::SetOut($stdout)',
    '[Console]::SetError($stderr)',
    'try {',
    `  $code = & ${powershellLiteral(helper)} -Config ${powershellLiteral(config)}`,
    '  if ($null -eq $code) { throw "AppContainer helper did not return an exit code" }',
    '  exit [int]$code',
    '} catch {',
    '  [Console]::Error.WriteLine("AppContainer helper was blocked or failed to start: " + $_.Exception.Message)',
    '  exit 125',
    '}',
  ].join('\n')
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')]
}
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
  return executeSandboxed(options, root, network)
}
/**
 * Where the sandboxed child starts, expressed inside the snapshot.
 *
 * `root` and `options.cwd` arrive spelled the way the caller spelled them, which is not
 * always how the OS spells them: %TEMP% on Windows returns short names
 * (C:\Users\RUNNER~1\...) and macOS temporary directories are symlinks under /var. A
 * relative path built from one real path and one literal path then climbs out with '..',
 * so the child started outside the snapshot, where the AppContainer has no grant and the
 * Seatbelt profile has no binding. Windows answered "The current directory is invalid."
 * and the backend looked broken on that host. Both sides are normalised here, and a path
 * that still leaves the workspace is refused rather than executed where nothing covers it.
 */
export async function sandboxWorkingDirectory(work: string, root: string, cwd: string): Promise<string> {
  const realRoot = await realpath(root)
  return resolve(work, relative(realRoot, await insideRoot(root, realRoot, cwd)))
}
// Windows compares paths case-insensitively; POSIX must not, or /a and /A would merge.
const samePath = (left: string, right: string) => (process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right)
const underPath = (value: string, prefix: string) => (process.platform === 'win32' ? value.toLowerCase().startsWith(prefix.toLowerCase()) : value.startsWith(prefix))
async function insideRoot(root: string, realRoot: string, cwd: string): Promise<string> {
  const prefix = root.endsWith(sep) ? root : root + sep
  // Re-spell the caller's path under the real root before comparing, so a path that
  // does not exist yet still maps correctly instead of failing a realpath lookup.
  const respelled = samePath(cwd, root) ? realRoot : underPath(cwd, prefix) ? resolve(realRoot, cwd.slice(prefix.length)) : undefined
  const target = respelled ?? await realpath(cwd).catch(() => undefined)
  if (!target) return realRoot
  const inside = relative(realRoot, target)
  return inside === '' || (!inside.startsWith('..') && !isAbsolute(inside)) ? target : realRoot
}
async function executeSandboxed(options: WorkspaceProcessOptions, root: string, network: boolean) {
  const snapshot = await createSandboxSnapshot(root)
  try {
    const cwd = await sandboxWorkingDirectory(snapshot.work, root, options.cwd)
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
      // PowerShell's module analysis cache must also stay in writable scratch.
      Object.assign(env, { PSModuleAnalysisCachePath: resolve(snapshot.scratch, 'ModuleAnalysisCache') })
      const config = resolve(snapshot.directory, 'launch.json')
      let args = options.args
      if (options.executable.toLowerCase().endsWith('\\cmd.exe')) {
        const script = resolve(snapshot.scratch, 'command.cmd')
        await writeFile(script, windowsBatchScript(options.args[3]))
        args = ['/d', '/s', '/c', script]
      }
      await writeFile(config, JSON.stringify({ executable: options.executable, args, cwd, work: snapshot.work, scratch: snapshot.scratch, network, timeoutMs: options.timeoutMs ?? 120000 }), { mode: 0o600 })
      // The trusted .NET compiler must use the host temp location. Its protected
      // compilation directories must never be relabelled as AppContainer scratch.
      // The helper switches TEMP/TMP before creating the restricted child.
      const helper = resourcePath('workspace-appcontainer.ps1')
      result = await runWorkspaceProcess({
        ...options,
        timeoutMs: (options.timeoutMs ?? 120000) + 60000,
        executable: resolve(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        // Bypass applies only to this child process so the bundled, trusted helper
        // can run; it does not change the user's or machine's execution policy.
        // A UTF-8 bootstrap also keeps PowerShell's own policy errors readable.
        args: windowsAppContainerPowerShellArgs(helper, config),
        cwd,
        env: { ...env, TEMP: process.env.TEMP, TMP: process.env.TMP }
      })
    }
    options.signal?.throwIfAborted()
    if (result.exitCode === 0) await applySandboxSnapshot(snapshot)
    return { ...result, stderr: result.stderr + (result.exitCode !== 0 ? '\nSandbox execution failed; temporary workspace changes were not applied. No host fallback was attempted.' : '') }
  } finally { await rm(snapshot.directory, { recursive: true, force: true }) }
}
