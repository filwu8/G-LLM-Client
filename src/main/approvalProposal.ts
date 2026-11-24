/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Turning one approval into a durable rule.
 *
 * The approval dialog answers a single call. When the same shape of call comes
 * back for the tenth time, re-asking is not diligence, it is friction that
 * trains the user to click through. This module decides what a "always allow"
 * answer would actually record, and — more importantly — when refusing to
 * record anything is the only honest answer.
 *
 * A proposal is withheld whenever a rule could not be safe:
 *  - desktop control (computer/browser) acts outside any workspace and cannot
 *    be confined by a path pattern, so it asks every time by design;
 *  - an unconfined operation (host execution) can never be made safe by a rule,
 *    which is the same invariant `executionPolicy.ts` protects;
 *  - a script is arbitrary code, so there is no stable pattern to name;
 *  - git has its own grant store with its own TTLs and per-repository scoping.
 *
 * The proposed resource is deliberately the coarsest thing that still means
 * "this operation": the command class for shell, the exact path for a file.
 */

import type { PermissionRule } from './approvalRules.ts'
import { commandIdentity } from './workspaceAgentPolicy.ts'

/** Tools that mutate a file identified by a workspace-relative path. */
const PATH_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'replace_text',
  'create_directory',
  'move_file',
  'delete_file',
  'compress_image',
  'compress_pdf',
  'generate_image',
  'create_docx',
  'create_pdf',
  'set_docx_header_image'
])

/** Tools that run arbitrary code, where no pattern can name the operation. */
const SCRIPT_ACTIONS: ReadonlySet<string> = new Set(['execute'])

/**
 * Tools that must never be remembered, whatever the caller says.
 *
 * `capability` is derived at the call site, and a call site that forgets to
 * pass it would otherwise offer a durable "always allow" for desktop control
 * or for a whole delegated task. Those are the two cases where a saved rule
 * would authorise work that cannot be previewed, so the guard belongs here as
 * well as at the call site.
 */
const NEVER_REMEMBER_TOOLS: ReadonlySet<string> = new Set([
  'run_computer_command',
  'browser_action',
  'computer_window',
  'browser_window',
  'delegate_to_harness'
])

/** One operation expressed in the vocabulary the rule engine matches on. */
export interface ToolPermissionRequest {
  /** `shell`, `edit`, `execute`, `git`, `read`, or `desktop`. */
  action: string
  /** Command text for `shell`, workspace-relative path for `edit`. */
  resource: string
}

export interface ApprovalProposal {
  /** The rule a "always allow" answer would persist. */
  rule: PermissionRule
  /** Short human description, e.g. `git status *`. */
  label: string
}

/**
 * Express a tool call in the rule engine's vocabulary.
 *
 * Returns `undefined` when the call has no identity a rule could name. An empty
 * resource is never returned: a rule keyed on an empty string would match
 * nothing and silently do the wrong thing.
 */
export function describeToolPermission(input: {
  tool: string
  args: Record<string, unknown>
  executedCode?: string
  relativePath?: string
}): ToolPermissionRequest | undefined {
  const tool = String(input.tool ?? '').trim()
  const args = input.args ?? {}
  if (tool === 'git_write') {
    const operation = String(args.operation ?? '').trim()
    return operation ? { action: 'git', resource: operation } : undefined
  }
  if (tool === 'run_shell' || tool === 'run_computer_command') {
    const code = String(input.executedCode ?? args.code ?? '').trim()
    return code ? { action: 'shell', resource: code } : undefined
  }
  if (tool === 'start_background') {
    const code = String(args.code ?? '').trim()
    if (!code) return undefined
    return { action: args.language === 'python' ? 'execute' : 'shell', resource: code }
  }
  if (tool === 'run_javascript' || tool === 'run_python') {
    const code = String(args.code ?? '').trim()
    return code ? { action: 'execute', resource: code } : undefined
  }
  if (PATH_EDIT_TOOLS.has(tool)) {
    const path = String(input.relativePath ?? args.path ?? args.output ?? args.to ?? args.document ?? '').trim()
    return path ? { action: 'edit', resource: path } : undefined
  }
  return undefined
}

/**
 * What "always allow" would save for this call, or `undefined` when it must not
 * be offered at all.
 *
 * Withholding is the safe default: a missing button costs one extra click, a
 * wrong rule persists across every future conversation in that folder.
 */
export function proposeApprovalRule(
  permission: ToolPermissionRequest | undefined,
  context: {
    tool: string
    capability?: 'computer' | 'browser'
    confined: boolean
    executionMode?: 'sandbox' | 'host'
  }
): ApprovalProposal | undefined {
  if (!permission) return undefined
  // Desktop control cannot be path-confined, so no pattern can authorise it.
  if (context.capability) return undefined
  if (NEVER_REMEMBER_TOOLS.has(String(context.tool ?? '').trim())) return undefined
  // A rule may never widen confinement; an unconfined operation keeps asking.
  if (!context.confined || context.executionMode === 'host') return undefined
  // A script is arbitrary code: there is no stable pattern to name.
  if (SCRIPT_ACTIONS.has(permission.action)) return undefined
  // Git keeps its own grant store, with its own TTLs and repo scoping.
  if (permission.action === 'git') return undefined

  if (permission.action === 'shell') {
    const identity = commandIdentity(permission.resource)
    if (!identity) return undefined
    // Shell patterns name a command prefix, so a saved rule covers the same
    // command with different arguments instead of just this exact invocation.
    const resource = `${identity} *`
    return { rule: { action: 'shell', resource, effect: 'allow' }, label: resource }
  }
  if (permission.action === 'edit') {
    const resource = permission.resource
    return { rule: { action: 'edit', resource, effect: 'allow' }, label: resource }
  }
  return undefined
}
