/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { readFile, realpath, stat, unlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { isProtectedWorkspacePath } from './workspaceAgentPolicy.ts'
import { runWorkspaceProcess } from './workspaceProcess.ts'

export type GitReadOperation = 'status' | 'log' | 'diff' | 'branch' | 'remote' | 'show'
export type GitWriteOperation = 'fetch' | 'pull' | 'reset' | 'checkout' | 'clean' | 'stash'

const OPERATIONS: GitReadOperation[] = ['status', 'log', 'diff', 'branch', 'remote', 'show']
const WRITE_OPERATIONS: GitWriteOperation[] = ['fetch', 'pull', 'reset', 'checkout', 'clean', 'stash']
const MAX_OUTPUT_BYTES = 160_000

function safeLogLimit(value: unknown): number {
  const n = Math.round(Number(value))
  return Number.isFinite(n) && n >= 1 ? Math.min(100, n) : 20
}

function safeRef(value: unknown): string {
  const ref = String(value ?? '').trim()
  if (!ref) return ''
  if (!/^[0-9A-Za-z][0-9A-Za-z._\-/^~]{0,119}$/.test(ref)) throw new Error('无效的 Git 引用')
  return ref
}

function safeRelativePath(root: string, value: unknown): string {
  const input = String(value ?? '').trim()
  if (!input || isAbsolute(input) || input.startsWith('-')) throw new Error('路径必须是工作区内的相对路径')
  if (isProtectedWorkspacePath(input)) throw new Error('该路径受保护；仓库元数据请使用 git_read，凭据文件任何工具都不可访问')
  const target = resolve(root, input)
  const diff = relative(root, target)
  if (!diff || diff === '..' || diff.startsWith(`..${sep}`) || isAbsolute(diff)) throw new Error('路径超出当前会话工作区')
  return diff.split(sep).join('/')
}

/**
 * Discover independent git repositories inside an authorized workspace.
 * Used to tell the model up front which repos exist, so it never has to probe
 * protected .git paths itself (scripts cannot see them and report "MISSING").
 */
export async function discoverWorkspaceRepositories(root: string, maxDepth = 3, limit = 64): Promise<Array<{ path: string; branch: string | null }>> {
  const { readdir } = await import('node:fs/promises')
  const found: Array<{ path: string; branch: string | null }> = []
  const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: await realpath(root), rel: '.', depth: 0 }]
  const seen = new Set<string>()
  while (queue.length > 0 && found.length < limit) {
    const { dir, rel, depth } = queue.shift()!
    if (seen.has(dir)) continue
    seen.add(dir)
    const gitPath = resolve(dir, '.git')
    try {
      const info = await stat(gitPath)
      if (info.isDirectory() || info.isFile()) {
        let branch: string | null = null
        try {
          const head = await readFile(resolve(gitPath, 'HEAD'), 'utf8')
          const match = head.match(/^ref:\s*refs\/heads\/(.+)$/m)
          branch = match ? match[1].trim() : null
        } catch { /* bare/other layouts: leave branch unknown */ }
        found.push({ path: rel, branch })
      }
    } catch { /* no .git here */ }
    if (depth >= maxDepth) continue
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || isProtectedWorkspacePath(entry.name)) continue
        if (['node_modules', 'dist', 'out', '.venv', '__pycache__'].includes(entry.name)) continue
        queue.push({ dir: resolve(dir, entry.name), rel: rel === '.' ? entry.name : `${rel}/${entry.name}`, depth: depth + 1 })
      }
    } catch { /* skip unreadable directories */ }
  }
  return found
}

// Strip credentials that remote URLs or config-like output may contain.
export function redactGitOutput(text: string): string {
  return text
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^\s/@]+)@/g, '$1[REDACTED]@')
    .replace(/\b(token|password|passwd|secret|api[_-]?key)\s*[=:]\s*\S+/gi, (_match, name: string) => `${name}=[REDACTED]`)
}

/**
 * A git write killed by our own timeout (taskkill /F) cannot run its cleanup,
 * so it leaves <gitdir>/index.lock behind. That stale lock then blocks every
 * later git write in the same repo ("Unable to create index.lock: File exists"),
 * turning one slow operation into a permanent retry loop. Remove only the lock
 * our command created (mtime within the command window); never touch a lock
 * that predates the command, which may belong to a legitimate concurrent git.
 */
export async function clearStaleIndexLock(cwd: string, startedAtMs: number, endedAtMs = Date.now()): Promise<boolean> {
  const gitPath = resolve(cwd, '.git')
  let lockPath = resolve(gitPath, 'index.lock')
  try {
    const info = await stat(gitPath)
    if (info.isFile()) {
      // Worktree / submodule: .git is a file containing "gitdir: <path>".
      const content = (await readFile(gitPath, 'utf8')).trim()
      const match = content.match(/^gitdir:\s*(.+)$/i)
      if (!match) return false
      lockPath = resolve(cwd, match[1].trim(), 'index.lock')
    }
    const lockInfo = await stat(lockPath)
    // Only clear a lock created during our command window. A lock older than
    // the command belongs to another process and must not be removed.
    if (lockInfo.mtimeMs < startedAtMs - 1000) return false
    if (lockInfo.mtimeMs > endedAtMs + 1000) return false
    await unlink(lockPath)
    return true
  } catch {
    // No lock present, or already gone: nothing to clear.
    return false
  }
}

/**
 * Detect the stale-index.lock failure signature in git output. Both reads
 * (status refreshes the index) and writes can hit it, and git reports it as a
 * normal non-zero exit rather than throwing — so callers must inspect output
 * and heal proactively instead of relying on the timeout/catch path.
 */
export function isIndexLockConflict(text: string): boolean {
  return /index\.lock['"]?\s*:?.*file exists|unable to create ['"].*index\.lock/i.test(String(text ?? ''))
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    windir: process.env.windir,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    HOME: process.env.HOME ?? process.env.USERPROFILE,
    LANG: 'C.UTF-8',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat'
  }
}

// Fixed, read-only argument templates. The model never supplies raw flags.
// Global -c overrides stop user/system config from injecting hooks, pagers or external diff drivers.
function buildArguments(operation: GitReadOperation, args: Record<string, unknown>, root: string): string[] {
  const common = ['-c', 'core.hooksPath=gllm-disabled-hooks', '-c', 'core.pager=cat', '-c', 'safe.directory=*', '--no-pager']
  const path = args.path === undefined ? '' : safeRelativePath(root, args.path)
  switch (operation) {
    case 'status':
      return [...common, 'status', '--porcelain=v1', '-b', ...(path ? ['--', path] : [])]
    case 'log': {
      const ref = safeRef(args.ref)
      return [...common, 'log', '--oneline', '--decorate=short', '-n', String(safeLogLimit(args.limit)), ...(ref ? [ref] : []), ...(path ? ['--', path] : [])]
    }
    case 'diff': {
      const detail = args.detail === 'content' ? [] : ['--stat']
      return [...common, 'diff', '--no-ext-diff', '--no-textconv', ...detail, ...(path ? ['--', path] : [])]
    }
    case 'branch':
      return [...common, 'branch', '-a', '--no-color']
    case 'remote':
      return [...common, 'remote', '-v']
    case 'show': {
      const ref = safeRef(args.ref)
      if (!ref) throw new Error('show 操作需要提供 ref')
      const detail = args.detail === 'content' ? ['--format=fuller'] : ['--stat', '--format=oneline']
      return [...common, 'show', '--no-ext-diff', '--no-textconv', ...detail, ref]
    }
  }
}

export async function runGitRead(root: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ output: string }> {
  signal?.throwIfAborted()
  const operation = String(args.operation ?? '') as GitReadOperation
  if (!OPERATIONS.includes(operation)) throw new Error(`不支持的 git 操作：${operation}`)
  const rootReal = await realpath(root)
  const { cwd, repo } = await resolveGitCwd(rootReal, args)
  const argv = buildArguments(operation, args, rootReal)
  const maxCharacters = Math.max(2000, Math.min(20_000, Math.round(Number(args.maxCharacters)) || 8000))
  const runOnce = () => runWorkspaceProcess({
    executable: process.platform === 'win32' ? 'git.exe' : 'git',
    args: argv,
    cwd,
    env: gitEnvironment(),
    signal,
    // `git status` refreshes the index and can be slow on very large repos.
    timeoutMs: 120_000,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    outputOverflow: 'truncate'
  })
  const startedAtMs = Date.now()
  let result: Awaited<ReturnType<typeof runWorkspaceProcess>>
  try {
    result = await runOnce()
  } catch (error) {
    // A timed-out/killed git (even a read) leaves index.lock behind.
    await clearStaleIndexLock(cwd, startedAtMs)
    throw error
  }
  // git reports a stale lock as a normal non-zero exit, not an exception.
  // Heal it and retry once so a leftover lock from an earlier killed command
  // does not hard-block all later git operations.
  if (result.exitCode !== 0 && isIndexLockConflict(`${result.stdout}\n${result.stderr}`)) {
    const retryStartedAt = Date.now()
    await clearStaleIndexLock(cwd, 0, retryStartedAt)
    try {
      result = await runOnce()
    } catch (error) {
      await clearStaleIndexLock(cwd, retryStartedAt)
      throw error
    }
  }
  const raw = `Exit code: ${result.exitCode}${repo !== '.' ? `\nrepo: ${repo}` : ''}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`
  return { output: redactGitOutput(raw).slice(0, maxCharacters) }
}

function safeRemote(value: unknown): string {
  const name = String(value ?? '').trim()
  if (!name) return 'origin'
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/.test(name)) throw new Error('无效的 Git remote 名称')
  return name
}

/**
 * Resolve which repository inside the workspace a git command should run in.
 * Authorized workspaces often contain several independent clones (plus nested
 * submodules); `path` as a repo filter would otherwise silently act on the root
 * repository only. With `repo`, git runs with cwd inside that repository.
 */
async function resolveGitCwd(rootReal: string, args: Record<string, unknown>): Promise<{ cwd: string; repo: string }> {
  const input = args.repo === undefined ? '' : String(args.repo).trim()
  // discoverWorkspaceRepositories reports the root repository as "." and the
  // model is told to use that exact value for root-level git operations. Treat
  // "." (and its explicit separators) as the workspace root instead of letting
  // safeRelativePath reject an empty relative path as "outside the workspace".
  if (!input || input === '.' || input === './' || input === '.\\') return { cwd: rootReal, repo: '.' }
  const repo = safeRelativePath(rootReal, input)
  const target = resolve(rootReal, repo)
  const info = await realpath(target).then(() => stat(target)).catch(() => {
    throw new Error(`repo 目录不存在：${repo}`)
  })
  if (!info.isDirectory()) throw new Error(`repo 必须是工作区内的目录：${repo}`)
  const cwdReal = await realpath(target)
  const diff = relative(rootReal, cwdReal)
  if (diff.startsWith('..') || isAbsolute(diff)) throw new Error('repo 路径超出当前会话工作区')
  return { cwd: cwdReal, repo }
}

function safeBoolean(value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback
  if (value === true || value === 'true' || value === 1 || value === '1') return true
  if (value === false || value === 'false' || value === 0 || value === '0') return false
  throw new Error('无效的布尔参数')
}

/**
 * Build a fixed git write command from a small allowlist. The model supplies
 * only semantic fields (operation, remote, ref, path, flags); raw flags and
 * shell text are never accepted. Global -c overrides block hooks, pagers and
 * credential helpers that could otherwise be abused through config.
 */
function buildWriteArguments(operation: GitWriteOperation, args: Record<string, unknown>, root: string): string[] {
  const common = ['-c', 'core.hooksPath=gllm-disabled-hooks', '-c', 'core.pager=cat', '-c', 'core.askPass=echo', '-c', 'credential.helper=', '-c', 'safe.directory=*', '--no-pager']
  const path = args.path === undefined ? '' : safeRelativePath(root, args.path)
  switch (operation) {
    case 'fetch': {
      const remote = safeRemote(args.remote)
      const ref = safeRef(args.ref)
      // git fetch <remote> [ref] — no --tags/all that could widen scope silently.
      return [...common, 'fetch', remote, ...(ref ? [ref] : [])]
    }
    case 'pull': {
      const remote = safeRemote(args.remote)
      const ref = safeRef(args.ref)
      const rebase = safeBoolean(args.rebase)
      return [...common, 'pull', ...(rebase ? ['--rebase'] : ['--no-rebase']), remote, ...(ref ? [ref] : [])]
    }
    case 'reset': {
      const ref = safeRef(args.ref)
      if (!ref) throw new Error('reset 操作需要提供 ref')
      const mode = args.mode === 'soft' || args.mode === 'mixed' ? args.mode : 'hard'
      return [...common, 'reset', `--${mode}`, ref, ...(path ? ['--', path] : [])]
    }
    case 'checkout': {
      const ref = safeRef(args.ref)
      if (!ref) throw new Error('checkout 操作需要提供 ref')
      if (path) return [...common, 'checkout', ref, '--', path]
      return [...common, 'checkout', ref]
    }
    case 'clean': {
      const force = safeBoolean(args.force)
      if (!force) throw new Error('clean 操作需要 force=true 才会删除未跟踪文件')
      if (!path) throw new Error('clean 操作需要提供一个工作区内的相对路径范围')
      return [...common, 'clean', '-fd', '--', path]
    }
    case 'stash': {
      const action = args.action === 'pop' || args.action === 'apply' ? args.action : 'push'
      if (action === 'push') return [...common, 'stash', 'push', ...(String(args.message ?? '').trim() ? ['-m', String(args.message).trim().slice(0, 200)] : [])]
      return [...common, 'stash', action]
    }
  }
}

export interface GitWriteResult {
  output: string
  exitCode: number
}

/**
 * Bulk working-tree operations (reset/checkout/clean) can rewrite tens of
 * thousands of files on a large repo; the old flat 120s timeout killed git
 * mid-write and left index.lock behind. Give these a much larger ceiling.
 * The caller's AbortSignal still carries the global goal deadline, so a long
 * value here cannot make a run exceed its configured limit.
 */
export function gitWriteTimeoutMs(operation: GitWriteOperation): number {
  if (operation === 'reset' || operation === 'checkout' || operation === 'clean') return 600_000
  if (operation === 'fetch' || operation === 'pull') return 180_000
  return 180_000 // stash
}

/**
 * Run an allowlisted,审批-gated git write operation. Callers MUST obtain
 * approval through the workspace approval flow before invoking this; this
 * function only guarantees the command shape is safe and auditable.
 */
export async function runGitWrite(root: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<GitWriteResult> {
  signal?.throwIfAborted()
  const operation = String(args.operation ?? '') as GitWriteOperation
  if (!WRITE_OPERATIONS.includes(operation)) throw new Error(`不支持的 Git 写操作：${operation}`)
  const rootReal = await realpath(root)
  const { cwd, repo } = await resolveGitCwd(rootReal, args)
  const argv = buildWriteArguments(operation, args, rootReal)
  const maxCharacters = Math.max(2000, Math.min(20_000, Math.round(Number(args.maxCharacters)) || 8000))
  const runOnce = () => runWorkspaceProcess({
    executable: process.platform === 'win32' ? 'git.exe' : 'git',
    args: argv,
    cwd,
    env: gitEnvironment(),
    signal,
    timeoutMs: gitWriteTimeoutMs(operation),
    maxOutputBytes: MAX_OUTPUT_BYTES,
    outputOverflow: 'truncate'
  })
  const startedAtMs = Date.now()
  let result: Awaited<ReturnType<typeof runWorkspaceProcess>>
  try {
    result = await runOnce()
  } catch (error) {
    // A killed/aborted git cannot clear its own lock. Clean up the one created
    // by this command so a retry is not blocked by our own stale index.lock,
    // then surface the original timeout/cancel error to the caller.
    await clearStaleIndexLock(cwd, startedAtMs)
    throw error
  }
  // A stale lock left by an earlier killed command surfaces as exit 128 here
  // (a normal return, not the catch path). Heal it and retry once in place so
  // the operation succeeds without needing another model turn.
  if (result.exitCode !== 0 && isIndexLockConflict(`${result.stdout}\n${result.stderr}`)) {
    const retryStartedAt = Date.now()
    await clearStaleIndexLock(cwd, 0, retryStartedAt)
    try {
      result = await runOnce()
    } catch (error) {
      await clearStaleIndexLock(cwd, retryStartedAt)
      throw error
    }
  }
  const raw = `Exit code: ${result.exitCode}${repo !== '.' ? `\nrepo: ${repo}` : ''}\ngit ${argv.slice(argv.indexOf(operation)).join(' ')}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`
  return { output: redactGitOutput(raw).slice(0, maxCharacters), exitCode: result.exitCode }
}

export interface ProjectCheckPlan {
  label: string
  code: string
}

const CHECK_SCRIPTS: Record<string, string[]> = {
  test: ['test'],
  build: ['build'],
  typecheck: ['typecheck', 'type-check', 'tsc'],
  lint: ['lint']
}

const MANAGERS = [
  { lock: 'pnpm-lock.yaml', run: (script: string) => `pnpm ${script}` },
  { lock: 'yarn.lock', run: (script: string) => `yarn ${script}` },
  { lock: 'bun.lockb', run: (script: string) => `bun run ${script}` },
  { lock: 'package-lock.json', run: (script: string) => `npm run ${script}` }
]

/**
 * Derive a fixed verification command from the project manifest. The model only
 * chooses a check category; it never supplies shell text, so this stays allowlisted.
 */
export async function planProjectCheck(root: string, check: unknown): Promise<ProjectCheckPlan> {
  const category = String(check ?? '')
  const candidates = CHECK_SCRIPTS[category]
  if (!candidates) throw new Error('不支持的检查类型；请选择 test、build、typecheck 或 lint')
  const rootReal = await realpath(root)
  const manifest = resolve(rootReal, 'package.json')
  let scripts: Record<string, unknown> = {}
  try {
    const info = await stat(manifest)
    if (info.isFile() && info.size <= 1_000_000) scripts = JSON.parse(await readFile(manifest, 'utf8')).scripts ?? {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const script = candidates.find((name) => typeof scripts[name] === 'string' && (scripts[name] as string).trim())
  if (!script) throw new Error(`项目 package.json 中没有可用的 ${candidates.join(' / ')} 脚本`)
  let manager = MANAGERS[MANAGERS.length - 1]
  for (const entry of MANAGERS) {
    try {
      if ((await stat(resolve(rootReal, entry.lock))).isFile()) { manager = entry; break }
    } catch { /* lock file not present */ }
  }
  return { label: `${manager.run(script)} (${category})`, code: manager.run(script) }
}
