/**
 * Conversation-scoped memory of approved git write operations.
 *
 * A single user goal usually spans several agent runs (one run per turn, per
 * resume, per goal continuation), and often several app restarts. A run-local
 * flag therefore still re-prompts for the same operation on the next turn,
 * which reads as "the same question again". This module remembers the approval
 * per conversation + workspace + approval mode + operation kind, so:
 *  - fetch -> checkout -> reset asks once per operation kind, not once per run;
 *  - a *different* operation still asks, so destructive variants never inherit
 *    an unrelated approval;
 *  - re-authorizing a different folder does not inherit the old repository's
 *    approval, because the workspace root is part of the key;
 *  - switching the approval mode invalidates earlier grants, because the mode
 *    is part of the key.
 *
 * Grants are kept in memory and, when a storage directory is configured,
 * mirrored to `git-approvals.json` so a restart does not lose them.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Reversible operations: remembered for a normal working session. */
export const GIT_WRITE_GRANT_TTL_MS = 2 * 60 * 60 * 1000
/** Destructive operations (reset/clean): short grace window only. */
export const GIT_WRITE_DESTRUCTIVE_GRANT_TTL_MS = 10 * 60 * 1000

const DESTRUCTIVE_OPERATIONS = new Set(['reset', 'clean'])

/** Safety cap so a long-lived process cannot accumulate unbounded state. */
const MAX_SCOPES = 200

const grants = new Map<string, Map<string, number>>()

let resolveStorageDirectory: (() => string) | null = null
let loadedDirectory: string | null = null
let saveTimer: NodeJS.Timeout | null = null

export interface GitWriteGrantOptions {
  /** Approval mode in effect; changing it invalidates earlier grants. */
  approvalMode?: string
  /** Repository inside the workspace, when not the root repo. Scopes grants per repo. */
  repo?: string
  /** Injectable clock for tests. */
  now?: number
}

function ttlFor(operation: string): number {
  return DESTRUCTIVE_OPERATIONS.has(operation) ? GIT_WRITE_DESTRUCTIVE_GRANT_TTL_MS : GIT_WRITE_GRANT_TTL_MS
}

function normalizeRoot(rootPath: string): string {
  const trimmed = rootPath.trim().replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

function scopeKey(conversationId: string, rootPath: string, approvalMode?: string, repo = ''): string {
  return [conversationId.trim(), normalizeRoot(rootPath), (approvalMode ?? '').trim(), normalizeRoot(repo)].join('\u0000')
}

function approvalsFile(directory: string): string {
  return join(directory, 'git-approvals.json')
}

/**
 * Point grants at a persistent directory (the app data root). Call once at
 * startup; passing null keeps grants in memory only (tests, headless runs).
 */
export function configureGitWriteGrantStorage(resolveDirectory: (() => string) | null): void {
  resolveStorageDirectory = resolveDirectory
  loadedDirectory = null
}

function loadFromDisk(): void {
  const directory = resolveStorageDirectory?.()
  if (!directory || loadedDirectory === directory) return
  loadedDirectory = directory
  try {
    const file = approvalsFile(directory)
    if (!existsSync(file)) return
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { scopes?: Record<string, unknown> }
    const scopes = parsed?.scopes
    if (!scopes || typeof scopes !== 'object') return
    const now = Date.now()
    for (const [key, operations] of Object.entries(scopes)) {
      if (!operations || typeof operations !== 'object') continue
      const live = new Map<string, number>()
      for (const [operation, expiresAt] of Object.entries(operations as Record<string, unknown>)) {
        if (typeof expiresAt === 'number' && expiresAt > now) live.set(operation, expiresAt)
      }
      if (live.size > 0) grants.set(key, live)
    }
  } catch {
    // A corrupt or partially written file must never block approvals.
  }
}

function persistNow(): void {
  const directory = loadedDirectory ?? resolveStorageDirectory?.()
  if (!directory) return
  try {
    mkdirSync(directory, { recursive: true })
    const now = Date.now()
    const scopes: Record<string, Record<string, number>> = {}
    for (const [key, operations] of grants) {
      const live: Record<string, number> = {}
      for (const [operation, expiresAt] of operations) {
        if (expiresAt > now) live[operation] = expiresAt
      }
      if (Object.keys(live).length > 0) scopes[key] = live
    }
    const target = approvalsFile(directory)
    const temporary = `${target}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, scopes }), 'utf8')
    renameSync(temporary, target)
  } catch {
    // Persistence is best-effort; approvals still work in memory.
  }
}

function scheduleSave(): void {
  if (!resolveStorageDirectory || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistNow()
  }, 400)
  saveTimer.unref?.()
}

/** True when this conversation + workspace already approved this operation kind. */
export function hasGitWriteGrant(
  conversationId: string,
  rootPath: string,
  operation: string,
  options: GitWriteGrantOptions = {}
): boolean {
  const name = operation.trim()
  if (!conversationId.trim() || !rootPath.trim() || !name) return false
  loadFromDisk()
  const now = options.now ?? Date.now()
  const key = scopeKey(conversationId, rootPath, options.approvalMode, options.repo)
  const operations = grants.get(key)
  if (!operations) return false
  const expiresAt = operations.get(name)
  if (!expiresAt) return false
  if (expiresAt <= now) {
    operations.delete(name)
    if (operations.size === 0) grants.delete(key)
    return false
  }
  return true
}

/** Remember that the user allowed this git operation kind in this conversation. */
export function rememberGitWriteGrant(
  conversationId: string,
  rootPath: string,
  operation: string,
  options: GitWriteGrantOptions = {}
): void {
  const name = operation.trim()
  if (!conversationId.trim() || !rootPath.trim() || !name) return
  loadFromDisk()
  const key = scopeKey(conversationId, rootPath, options.approvalMode, options.repo)
  if (!grants.has(key) && grants.size >= MAX_SCOPES) {
    const oldest = grants.keys().next().value
    if (oldest) grants.delete(oldest)
  }
  const operations = grants.get(key) ?? new Map<string, number>()
  operations.set(name, (options.now ?? Date.now()) + ttlFor(name))
  grants.set(key, operations)
  scheduleSave()
}

/** Drop remembered grants; omit the id to clear everything (tests, shutdown). */
export function forgetGitWriteGrants(conversationId?: string): void {
  if (!conversationId) {
    grants.clear()
    scheduleSave()
    return
  }
  const prefix = `${conversationId.trim()}\u0000`
  for (const key of [...grants.keys()]) {
    if (key.startsWith(prefix)) grants.delete(key)
  }
  scheduleSave()
}
