/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Durable, workspace-scoped "always allow" rules.
 *
 * Two sources feed the rule engine, and they are kept apart on purpose:
 *
 *  - **Configured rules** come from a hand-written `approval-rules.json` in the
 *    data directory. This is the only place a `deny` can be written, and a
 *    configured `deny` is final: nothing an agent talks the user into can lift
 *    it. This is what makes "allow `git status`, block `git push`" expressible.
 *  - **Grants** are written by the approval dialog's "always allow" answer.
 *    They are scoped to one workspace root and can only ever add `allow`.
 *
 * Resolution order matters and is not negotiable:
 *   1. a configured `deny` decides immediately and grants are never consulted;
 *   2. otherwise a granted `allow` decides;
 *   3. otherwise the configured verdict stands, including `undefined`, which
 *      hands the question back to the two-axis baseline.
 *
 * If grants were simply appended after the configured list, the documented
 * last-match-wins order would let a saved click override an explicit deny. It
 * cannot: `deny` is checked first, in its own pass.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_PERMISSION_RULES,
  evaluatePermissionRules,
  normalizePermissionRules,
  type PermissionEffect,
  type PermissionMatchOptions,
  type PermissionRequest,
  type PermissionRule
} from './approvalRules.ts'

/** Bounded so a long-lived profile cannot accumulate unbounded grants. */
const MAX_WORKSPACES = 64

export const CONFIGURED_RULES_FILE = 'approval-rules.json'
export const GRANTED_RULES_FILE = 'approval-grants.json'

const grants = new Map<string, PermissionRule[]>()

let resolveStorageDirectory: (() => string) | null = null
let loadedDirectory: string | null = null

interface ConfiguredCache {
  path: string
  mtimeMs: number
  rules: PermissionRule[]
}
let configuredCache: ConfiguredCache | null = null

/** Windows paths are case-insensitive, so the scope key must be too. */
function normalizeRoot(rootPath: string): string {
  const trimmed = String(rootPath ?? '').trim().replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
}

/**
 * Point the store at a persistent directory. Call once at startup; passing null
 * keeps grants in memory only (tests, headless runs).
 */
export function configureApprovalGrantStorage(resolveDirectory: (() => string) | null): void {
  resolveStorageDirectory = resolveDirectory
  loadedDirectory = null
  configuredCache = null
}

function grantsFile(directory: string): string {
  return join(directory, GRANTED_RULES_FILE)
}

function loadFromDisk(): void {
  const directory = resolveStorageDirectory?.()
  if (!directory || loadedDirectory === directory) return
  loadedDirectory = directory
  const file = grantsFile(directory)
  if (!existsSync(file)) return
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { workspaces?: Record<string, unknown> }
    const workspaces = parsed?.workspaces
    if (!workspaces || typeof workspaces !== 'object') return
    for (const [root, rules] of Object.entries(workspaces)) {
      try {
        const normalized = normalizePermissionRules(rules).slice(0, MAX_PERMISSION_RULES)
        if (normalized.length > 0) grants.set(root, normalized)
      } catch {
        // One corrupt workspace entry must not discard every other grant.
      }
    }
  } catch {
    // A corrupt or partially written file must never block approvals; the
    // configured rules still apply, which is the stricter of the two sources.
  }
}

function persistNow(): void {
  const directory = loadedDirectory ?? resolveStorageDirectory?.()
  if (!directory) return
  try {
    mkdirSync(directory, { recursive: true })
    const workspaces: Record<string, PermissionRule[]> = {}
    for (const [root, rules] of grants) {
      if (rules.length > 0) workspaces[root] = rules
    }
    const target = grantsFile(directory)
    const temporary = `${target}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, workspaces }), 'utf8')
    renameSync(temporary, target)
  } catch {
    // Persistence is best-effort; the in-memory grants still work this session.
  }
}

/** Grants recorded for one workspace root, in the order they were added. */
export function listApprovalGrants(rootPath: string): PermissionRule[] {
  loadFromDisk()
  const rules = grants.get(normalizeRoot(rootPath))
  return rules ? rules.map((rule) => ({ ...rule })) : []
}

/**
 * Record an "always allow" answer.
 *
 * Only `allow` is accepted. A `deny` written here would be a durable, silently
 * installed block that the user never reviewed in a configuration file, so the
 * only way to add a deny is to write one down deliberately.
 */
export function rememberApprovalGrant(rootPath: string, rule: PermissionRule): void {
  const root = normalizeRoot(rootPath)
  if (!root) return
  if (!rule || rule.effect !== 'allow') throw new Error('只能记住 allow 规则；拒绝请写进 approval-rules.json')
  if (!String(rule.action ?? '').trim() || !String(rule.resource ?? '').trim()) {
    throw new Error('记住授权需要 action 和 resource')
  }
  loadFromDisk()
  const existing = grants.get(root) ?? []
  const duplicate = existing.some((entry) =>
    entry.action === rule.action && entry.resource === rule.resource && entry.effect === rule.effect)
  if (duplicate) return
  const next = [...existing, { action: rule.action, resource: rule.resource, effect: rule.effect }]
  if (next.length > MAX_PERMISSION_RULES) next.splice(0, next.length - MAX_PERMISSION_RULES)
  grants.set(root, next)
  if (grants.size > MAX_WORKSPACES) {
    const oldest = grants.keys().next().value
    if (oldest !== undefined && oldest !== root) grants.delete(oldest)
  }
  // Written through immediately rather than debounced: an "always allow" is a
  // user decision, and a quit within the debounce window would silently drop
  // it, so the next session would ask the same question again. The write is a
  // few hundred bytes and happens once per click, not once per tool call.
  persistNow()
}

/** Drop grants for one workspace; omit the root to clear everything. */
export function forgetApprovalGrants(rootPath?: string): void {
  loadFromDisk()
  if (rootPath === undefined) {
    grants.clear()
    if (resolveStorageDirectory) persistNow()
    return
  }
  grants.delete(normalizeRoot(rootPath))
  if (resolveStorageDirectory) persistNow()
}

/**
 * Read the hand-written rule file, cached on mtime.
 *
 * A malformed file throws instead of degrading to "no rules". Dropping the list
 * would silently disable a `deny` the user wrote on purpose, and under `auto`
 * or `full` the baseline for a confined operation is "do not ask" — so a typo
 * would turn a block into an automatic approval. Loud is the only safe failure
 * mode for a security configuration.
 */
export function loadConfiguredApprovalRules(): PermissionRule[] {
  const directory = resolveStorageDirectory?.()
  if (!directory) return []
  const path = join(directory, CONFIGURED_RULES_FILE)
  try {
    const stats = statSync(path)
    if (configuredCache && configuredCache.path === path && configuredCache.mtimeMs === stats.mtimeMs) {
      return configuredCache.rules.map((rule) => ({ ...rule }))
    }
    const rules = normalizePermissionRules(JSON.parse(readFileSync(path, 'utf8')))
    configuredCache = { path, mtimeMs: stats.mtimeMs, rules }
    return rules.map((rule) => ({ ...rule }))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${CONFIGURED_RULES_FILE} 无法读取或格式有误，已停止按未配置状态运行：${detail}`)
  }
}

/**
 * Resolve one operation against configured rules and grants.
 *
 * Returns `undefined` when neither source speaks, which is the signal that the
 * caller's two-axis baseline still owns the decision.
 */
export function evaluateApprovalRules(input: {
  root: string
  request: PermissionRequest
  configured: readonly PermissionRule[]
  options?: PermissionMatchOptions
}): PermissionEffect | undefined {
  const configured = evaluatePermissionRules(input.configured, input.request, input.options)
  // A configured deny is final: a saved click must never lift it.
  if (configured === 'deny') return 'deny'
  const granted = evaluatePermissionRules(listApprovalGrants(input.root), input.request, input.options)
  if (granted === 'allow') return 'allow'
  return configured
}
