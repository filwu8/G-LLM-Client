/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Tool-call hooks: the seam between "the model asked for a tool" and "the tool
 * ran". Mirrors the shape of OpenCode's `tool.execute.before` / `execute.after`
 * plugin hooks, but deliberately narrower in two places:
 *
 *  - A hook can refuse a call and can attach a note. It cannot approve one.
 *    Approval lives in approvalRules.ts / approvalGrantStore.ts, which is the
 *    only place allowed to turn a saved rule into a decision. A hook that could
 *    approve would be a second, unaudited permission system that no dialog, no
 *    rule file and no rejection ledger would ever see.
 *  - A hook cannot rewrite arguments. A rewrite is only honest if it happens
 *    before the approval prompt, so the user approves what actually runs -- and
 *    by then our approval path already holds values derived from the original
 *    arguments (the prepared native command, the resolved operation target).
 *    Supporting rewrites means re-deriving all of that, which is its own change
 *    with its own tests, not a flag on this one.
 *
 * The failure modes are intentionally asymmetric:
 *  - `before` fails closed. Nothing has run yet, and a hook that cannot complete
 *    its check cannot promise the call is allowed, so the call is refused.
 *  - `after` fails open. The side effect already happened; a broken observer
 *    must not turn a successful call into a failed one.
 *
 * `after` hooks only fire for a call that produced a result. A call that threw is
 * reported to the model by the loop itself, and observing it here would give a
 * hook a second way to describe a failure the loop already described.
 */
/** Files that hold the client's own permission state. */
export const APPROVAL_CONFIG_FILES: readonly string[] = ['approval-rules.json', 'approval-grants.json']

const PERMISSION_FILE_GUARD_ID = 'permission-file-guard'

/** Arguments that name a path a tool is about to read or write. */
const PATH_ARGUMENTS: readonly string[] = ['path', 'output', 'to', 'file']

export interface ToolHookContext {
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  readonly workspaceRoot: string
  readonly runId: string
}

/** What a hook is allowed to observe after the fact. */
export interface ToolHookOutcome {
  readonly output: string
  readonly exitCode?: number
}

/** A note is additive: it is appended to the tool result the model sees. */
export interface ToolHookNote {
  readonly note?: string
}

/** A veto. Only `before` hooks may return one. */
export interface ToolHookVerdict extends ToolHookNote {
  readonly block?: string
}

export interface ToolHook {
  readonly id: string
  before?(context: ToolHookContext): ToolHookVerdict | void
  after?(context: ToolHookContext, outcome: ToolHookOutcome): ToolHookNote | void
}

export interface ToolHookRunResult {
  readonly block?: string
  readonly notes: string[]
}

/**
 * Runs every `before` hook in registration order and stops at the first veto.
 * Later hooks are not consulted after a block: whatever they would have added is
 * moot, and calling them would mean running policy checks against a call that
 * will never execute.
 */
export function runBeforeToolHooks(hooks: readonly ToolHook[], context: ToolHookContext): ToolHookRunResult {
  const notes: string[] = []
  for (const hook of hooks) {
    if (!hook.before) continue
    let verdict: ToolHookVerdict | void
    try {
      verdict = hook.before(context)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { block: `Blocked by tool hook ${hook.id}: the hook itself failed (${detail}). Nothing was executed.`, notes }
    }
    if (verdict?.note) notes.push(verdict.note)
    if (verdict?.block) return { block: verdict.block, notes }
  }
  return { notes }
}

/**
 * Runs every `after` hook, even when one throws. Notes are collected in order so
 * the transcript reads the same way every run.
 */
export function runAfterToolHooks(hooks: readonly ToolHook[], context: ToolHookContext, outcome: ToolHookOutcome): ToolHookRunResult {
  const notes: string[] = []
  for (const hook of hooks) {
    if (!hook.after) continue
    try {
      const verdict = hook.after(context, outcome)
      if (verdict?.note) notes.push(verdict.note)
    } catch {
      // The work is done; an exception here must not retract it.
    }
  }
  return { notes }
}

/**
 * Appends hook notes to a tool result. With no notes the string is returned
 * unchanged -- byte for byte, no trailing newline -- so hooks that have nothing
 * to say cannot alter the transcript or the output cache keys.
 */
export function appendToolHookNotes(output: string, notes: readonly string[]): string {
  if (notes.length === 0) return output
  return `${output}\n\n${notes.map((note) => `[hook] ${note}`).join('\n')}`
}

/**
 * Refuses to hand our own permission files to a tool.
 *
 * This is deliberately not the only defence: the OS sandbox denies writes outside
 * the workspace and the approval rules are stored under the app data directory.
 * The hook exists so the invariant survives a future relaxation of either -- an
 * agent that can read or rewrite the rules it is judged by does not have rules.
 *
 * Only path-bearing arguments are inspected. Scanning free text or shell source
 * for the file names would block this very repository's own documentation and
 * its tests, and a tripwire that fires on prose gets removed within a week. A
 * shell command that reaches those paths is the sandbox's problem, not ours.
 */
export const permissionFileGuard: ToolHook = {
  id: PERMISSION_FILE_GUARD_ID,
  before(context) {
    for (const key of PATH_ARGUMENTS) {
      const value = context.args[key]
      if (typeof value !== 'string' || !value.trim()) continue
      const name = value.split(/[\\/]/).pop()?.trim().toLowerCase() ?? ''
      if (!APPROVAL_CONFIG_FILES.includes(name)) continue
      return { block: `Blocked by tool hook ${PERMISSION_FILE_GUARD_ID}: ${name} is the client's own approval configuration. A task may not read or rewrite the rules it is judged by; ask the user to make this change by hand.` }
    }
    return undefined
  }
}

export const BUILTIN_TOOL_HOOKS: readonly ToolHook[] = [permissionFileGuard]
