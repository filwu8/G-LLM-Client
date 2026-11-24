/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Ordered permission rules: the expressive half of the execution policy.
 *
 * `executionPolicy.ts` answers "how confined is this operation, and does the
 * user want to be asked?". That model is deliberately coarse: it has three
 * sandbox modes and three approval policies, and every tool falls into one
 * cell. It cannot express "allow `git status` but block `git push`", which is
 * the shape users actually ask for once they have clicked "allow" for the
 * fortieth time.
 *
 * This module adds that expressiveness without weakening the two-axis model:
 *
 *  1. Rules are *ordered* and the last matching rule wins, so a broad rule can
 *     be written first and narrowed by exceptions after it. This is the same
 *     resolution order OpenCode documents for its `permissions` array.
 *  2. A rule may only speak for the operations it names. When no rule matches,
 *     {@link evaluatePermissionRules} returns `undefined` and the caller keeps
 *     using the existing two-axis decision. Rules add information; they never
 *     replace the baseline.
 *  3. `allow` can never relax an unconfined operation. {@link decidePermission}
 *     enforces this, because "no approval setting can make an unconfined
 *     operation safe" is the invariant the whole execution policy exists to
 *     protect. A rule that could waive it would quietly undo `executionPolicy`.
 *
 * Everything here is pure: no Electron import, no filesystem access, no clock.
 * That is what makes it testable, and it is why this module can land before any
 * caller does.
 */

/** What a rule decides for a matching operation. */
export type PermissionEffect = 'allow' | 'ask' | 'deny'

export interface PermissionRule {
  /** Action being governed, e.g. `read`, `edit`, `shell`. `*` matches any. */
  readonly action: string
  /** Value the action is applied to: a path, a command, a URL. `*` matches any. */
  readonly resource: string
  readonly effect: PermissionEffect
}

/** One operation, which may touch several resources (a patch hits many files). */
export interface PermissionRequest {
  readonly action: string
  readonly resources: readonly string[]
}

export interface PermissionMatchOptions {
  /**
   * Fold case while matching. Windows paths and Windows command names are
   * case-insensitive, so the desktop caller passes `true` there. The default
   * is resolved by {@link defaultCaseInsensitive} rather than hardcoded, so
   * tests can exercise both branches on one machine.
   */
  caseInsensitive?: boolean
  /**
   * Shell-style convenience: a pattern ending in `" *"` also matches the same
   * command with the argument list omitted, so `git status *` covers a bare
   * `git status`. Off by default because it only makes sense for command text,
   * never for paths — `src/*` must not match `src`.
   */
  optionalTrailingArguments?: boolean
}

/** Safety cap: a runaway config must not turn every approval into a scan. */
export const MAX_PERMISSION_RULES = 256

/**
 * Upper bound on a single pattern. The matcher compiles to a regular
 * expression, so an unbounded pattern is an unbounded compile.
 */
const MAX_PATTERN_LENGTH = 4096

/**
 * Upper bound on a resource string. A longer value is treated as "matches
 * nothing", which degrades to the conservative default rather than to `allow`.
 */
const MAX_RESOURCE_LENGTH = 4096

const EFFECTS: ReadonlySet<string> = new Set<PermissionEffect>(['allow', 'ask', 'deny'])

/**
 * Actions whose resource is command text rather than a path. Command text needs
 * different normalization: collapsing whitespace is a *tightening* (a deny for
 * `rm -rf` also catches `rm  -rf`), while collapsing it in a path would be a
 * loosening.
 */
const COMMAND_ACTIONS: ReadonlySet<string> = new Set(['shell', 'execute'])

/** Platform default for {@link PermissionMatchOptions.caseInsensitive}. */
export function defaultCaseInsensitive(): boolean {
  return process.platform === 'win32'
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string') throw new Error(message)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}

/**
 * Normalize command text for matching.
 *
 * Whitespace runs collapse to a single space. This matters for correctness, not
 * tidiness: `rm  -rf /` (two spaces) executes exactly like `rm -rf /`, so a
 * `deny` rule that only matched the single-space spelling would be trivially
 * bypassable by a model that emits an extra space.
 */
export function normalizeCommand(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

/** Normalize a path-like resource. Backslashes become forward slashes. */
export function normalizeResourcePath(value: unknown): string {
  return String(value ?? '').trim().replace(/\\/g, '/')
}

function normalizeForAction(action: string, value: unknown): string {
  return COMMAND_ACTIONS.has(action) ? normalizeCommand(value) : normalizeResourcePath(value)
}

/**
 * Compile a whole-value wildcard pattern.
 *
 * `*` is zero or more of any character (including `/`), `?` is exactly one.
 * Everything else is literal — a pattern containing `.` must not behave as a
 * regex `.`, and a `(` must not open a group.
 *
 * Consecutive `*` are collapsed first. `**` and `*` mean the same thing to a
 * whole-value matcher, and leaving them separate would create the `.*.*`
 * backtracking pair that makes a long non-matching input expensive.
 */
function compilePattern(pattern: string, caseInsensitive: boolean): RegExp {
  const collapsed = pattern.replace(/\*+/g, '*')
  let source = ''
  for (const character of collapsed) {
    if (character === '*') source += '[\\s\\S]*'
    else if (character === '?') source += '[\\s\\S]'
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, caseInsensitive ? 'iu' : 'u')
}

function matchesValue(pattern: string, value: string, caseInsensitive: boolean): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH || value.length > MAX_RESOURCE_LENGTH) return false
  return compilePattern(pattern, caseInsensitive).test(value)
}

/**
 * Whether `pattern` matches the whole of `value`.
 *
 * Exported separately from the evaluator so the wildcard rules can be tested
 * and reasoned about on their own.
 */
export function matchesPattern(pattern: string, value: string, options: PermissionMatchOptions = {}): boolean {
  const caseInsensitive = options.caseInsensitive ?? defaultCaseInsensitive()
  if (matchesValue(pattern, value, caseInsensitive)) return true
  if (options.optionalTrailingArguments && pattern.endsWith(' *')) {
    // `git status *` also covers `git status`. Slicing off the trailing " *"
    // leaves the command itself, matched exactly.
    return matchesValue(pattern.slice(0, -2), value, caseInsensitive)
  }
  return false
}

/**
 * Parse a rule list from configuration.
 *
 * Any malformed entry throws. Silently dropping a bad rule would be the worst
 * possible behavior: a typo in `"effect": "deny"` would remove the rule
 * entirely, the operation would fall back to the baseline, and under `auto` or
 * `full` the baseline is "do not ask". A configuration error must be loud.
 *
 * Unknown properties are ignored so a newer version's rules still load.
 */
export function normalizePermissionRules(input: unknown): PermissionRule[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) throw new Error('权限规则必须是数组')
  if (input.length > MAX_PERMISSION_RULES) {
    throw new Error(`权限规则最多 ${MAX_PERMISSION_RULES} 条，当前 ${input.length} 条`)
  }
  return input.map((entry, index) => {
    const position = index + 1
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`第 ${position} 条权限规则必须是对象`)
    }
    const record = entry as Record<string, unknown>
    const action = requireText(record.action, `第 ${position} 条权限规则缺少 action`)
    const resource = requireText(record.resource, `第 ${position} 条权限规则缺少 resource`)
    const effect = record.effect
    if (typeof effect !== 'string' || !EFFECTS.has(effect)) {
      throw new Error(`第 ${position} 条权限规则的 effect 必须是 allow、ask 或 deny`)
    }
    if (action.length > MAX_PATTERN_LENGTH) throw new Error(`第 ${position} 条权限规则的 action 过长`)
    if (resource.length > MAX_PATTERN_LENGTH) throw new Error(`第 ${position} 条权限规则的 resource 过长`)
    return { action, resource, effect: effect as PermissionEffect }
  })
}

/**
 * Resolve the configured rules against one operation.
 *
 * Resolution per resource is last-match-wins, matching the documented behavior
 * of OpenCode's `permissions` array. Results across resources then combine
 * strictly:
 *
 *  - any `deny` wins, so a patch cannot be allowed by its other files;
 *  - a resource that matched no rule counts as `ask` *when some other resource
 *    did match*. Without this, an operation could dodge a rule by touching a
 *    second path the rules never mention;
 *  - when *no* resource matched any rule the result is `undefined`, leaving the
 *    decision to the caller's baseline.
 */
export function evaluatePermissionRules(
  rules: readonly PermissionRule[],
  request: PermissionRequest,
  options: PermissionMatchOptions = {}
): PermissionEffect | undefined {
  const action = String(request.action ?? '').trim()
  if (!action) throw new Error('权限判定必须指定 action')
  const resources = request.resources
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error('权限判定必须指明至少一个 resource；没有资源就无法判定，也不该默认放行')
  }
  const caseInsensitive = options.caseInsensitive ?? defaultCaseInsensitive()
  const effects = resources.map((rawResource) => {
    const resource = normalizeForAction(action, rawResource)
    let matched: PermissionEffect | undefined
    for (const rule of rules) {
      if (!matchesPattern(rule.action, action, { caseInsensitive })) continue
      if (!matchesPattern(rule.resource, resource, { caseInsensitive, optionalTrailingArguments: options.optionalTrailingArguments })) continue
      // Last match wins: keep overwriting instead of breaking on the first hit.
      matched = rule.effect
    }
    return matched
  })
  if (effects.every((effect) => effect === undefined)) return undefined
  if (effects.includes('deny')) return 'deny'
  if (effects.includes('ask') || effects.includes(undefined)) return 'ask'
  return 'allow'
}

export interface PermissionDecision {
  /** The operation must not run at all. */
  blocked: boolean
  /** The operation may run, but only after a per-call decision from the user. */
  needsApproval: boolean
  /** Why the decision came out this way; surfaced in logs and the approval UI. */
  reason: 'deny-rule' | 'unconfined' | 'allow-rule' | 'ask-rule' | 'baseline'
}

/**
 * Combine a rule verdict with the two-axis baseline.
 *
 * Precedence is deliberate:
 *
 *  1. `deny` first. It is the one verdict that always holds, and it has to hold
 *     even for an unconfined operation — blocking is a tightening.
 *  2. Then the unconfined guard. `executionPolicy.ts` states that no approval
 *     policy can make an unconfined operation safe; an `allow` rule must not be
 *     the loophole that finally does. Such an operation keeps asking.
 *  3. Then `allow` / `ask`, both of which only apply to a confined operation.
 *  4. Otherwise the caller's existing baseline decision stands unchanged.
 */
export function decidePermission(input: {
  baselineNeedsApproval: boolean
  effect?: PermissionEffect
  confined: boolean
}): PermissionDecision {
  const { baselineNeedsApproval, effect, confined } = input
  if (effect === 'deny') return { blocked: true, needsApproval: false, reason: 'deny-rule' }
  if (!confined) return { blocked: false, needsApproval: true, reason: 'unconfined' }
  if (effect === 'allow') return { blocked: false, needsApproval: false, reason: 'allow-rule' }
  if (effect === 'ask') return { blocked: false, needsApproval: true, reason: 'ask-rule' }
  return { blocked: false, needsApproval: baselineNeedsApproval, reason: 'baseline' }
}

/** One-line rule list for logs, so an approval decision can be traced back. */
export function describePermissionRules(rules: readonly PermissionRule[]): string {
  if (rules.length === 0) return 'permissions: none configured'
  return `permissions: ${rules.map((rule) => `${rule.action}:${rule.resource}=${rule.effect}`).join(' | ')}`
}
