/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * One execution policy, two orthogonal axes.
 *
 * Two independent designs converge on the same shape, which is why this module
 * follows it:
 *  - DeepSeek Harness keeps `sandbox` and `approval` apart in
 *    `dsh-permission-presets` (`{ sandbox, approval }`) instead of fusing them
 *    into one "mode".
 *  - OpenAI Codex keeps `sandbox_mode` apart from `approval_policy`.
 *
 * Fusing them loses information: "full permission mode" and "no sandbox" are
 * not the same claim, and a codebase that treats them as one will eventually
 * auto-approve something it never confined. Keeping the axes apart lets the
 * approval answer be *derived* from the confinement an operation actually runs
 * under. Harness states the same rule as "decide by enforced execution
 * boundaries, never by guessing what script text does".
 */

/** How much of the machine an operation can actually reach. */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** How much the user wants to be asked. Independent of SandboxMode. */
export type ApprovalPolicy = 'ask' | 'auto' | 'full'

/** What an operation is capable of, independent of where it happens to run. */
export type OperationKind = 'read' | 'write' | 'code' | 'network' | 'desktop'

export interface ExecutionPolicy {
  sandbox: SandboxMode
  approval: ApprovalPolicy
}

export interface OperationBoundary {
  kind: OperationKind
  /**
   * The confinement this operation really runs under. Callers must state it:
   * an unstated boundary is treated as unconfined, never as safe.
   */
  confinement?: SandboxMode
}

const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ['ask', 'auto', 'full']

/**
 * Unknown input (saved state from an older build, a hand-edited config, a value
 * a newer version invented) collapses to the tightest mode.
 *
 * This is a deliberate divergence from the `sdk-minimal` profile shipped with
 * Harness, which overrides the upstream `read-only` fail-safe with
 * `danger-full-access`. Fail-safe means "when in doubt, confine".
 */
export function normalizeSandboxMode(value: unknown): SandboxMode {
  return SANDBOX_MODES.includes(value as SandboxMode) ? (value as SandboxMode) : 'read-only'
}

/** Unknown approval input collapses to asking, the strictest policy. */
export function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  return APPROVAL_POLICIES.includes(value as ApprovalPolicy) ? (value as ApprovalPolicy) : 'ask'
}

export function resolveExecutionPolicy(sandbox: unknown, approval: unknown): ExecutionPolicy {
  return { sandbox: normalizeSandboxMode(sandbox), approval: normalizeApprovalPolicy(approval) }
}

/** Widening order: index 0 is the tightest. Used to forbid implicit widening. */
const SANDBOX_RANK: Record<SandboxMode, number> = {
  'read-only': 0,
  'workspace-write': 1,
  'danger-full-access': 2
}

/**
 * Strict widening only: an operation may narrow its own confinement freely but
 * may never widen it without the user. A delegated engine asking for
 * `danger-full-access` under a `workspace-write` baseline is asking to drop the
 * guardrail, so it is refused rather than merged.
 */
export function isWidening(from: SandboxMode, to: SandboxMode): boolean {
  return SANDBOX_RANK[to] > SANDBOX_RANK[from]
}

/** The tighter of two modes. A merge of two policies never widens. */
export function narrowSandboxMode(a: SandboxMode, b: SandboxMode): SandboxMode {
  return SANDBOX_RANK[a] <= SANDBOX_RANK[b] ? a : b
}

const ALLOWED_KINDS: Record<SandboxMode, ReadonlySet<OperationKind>> = {
  'read-only': new Set<OperationKind>(['read']),
  'workspace-write': new Set<OperationKind>(['read', 'write', 'code', 'network']),
  'danger-full-access': new Set<OperationKind>(['read', 'write', 'code', 'network', 'desktop'])
}

/**
 * Whether the confinement permits the operation at all, before any approval is
 * considered. A refusal here is not a prompt: the right answer is to narrow the
 * request, not to ask the user to widen the sandbox.
 */
export function allowsOperation(sandbox: SandboxMode, kind: OperationKind): boolean {
  return ALLOWED_KINDS[sandbox].has(kind)
}

/**
 * Whether this operation needs a per-call decision from the user.
 *
 * Desktop control is a hard boundary: it can act outside any workspace and
 * cannot be path-confined, so it asks in every mode.
 */
export function requiresApproval(policy: ExecutionPolicy, boundary: OperationBoundary): boolean {
  if (boundary.kind === 'desktop') return true

  // Fail-safe: an unstated boundary is unconfined. Reporting "safe" for a
  // boundary the caller never proved is the same class of mistake as trusting a
  // sandbox that was never applied.
  const confinement = boundary.confinement ?? 'danger-full-access'

  // Nothing confines this operation, so no approval mode can make it safe.
  // This is the concrete reason the two axes must stay separate: a fused
  // "full access mode" would silently auto-approve unrestricted execution.
  if (confinement === 'danger-full-access') return true

  switch (boundary.kind) {
    case 'read':
      // Reading inside the authorized workspace costs nothing to allow.
      return false
    case 'write':
    case 'code':
      // Confined writes and code run inside a workspace copy; asking is the
      // default and dropping the prompt is an explicit user choice.
      return policy.approval === 'ask'
    case 'network':
      // Egress is the one confined capability that can still exfiltrate.
      return policy.approval !== 'full'
  }
}

/**
 * Derive the boundary from the facts a tool dispatcher already knows, so the
 * mapping is stated once and can be tested rather than re-derived (and
 * eventually mis-derived) at each call site.
 */
export function boundaryFromTool(input: {
  isScript?: boolean
  canWrite?: boolean
  isNative?: boolean
  executionMode?: 'sandbox' | 'host'
  external?: boolean
  externalUnconfined?: boolean
  desktop?: boolean
}): OperationBoundary {
  const kind: OperationKind = input.desktop
    ? 'desktop'
    : input.external
      ? 'network'
      : input.isScript
        ? 'code'
        : input.canWrite
          ? 'write'
          : 'read'

  // Native commands in host mode and local unconfined external processes (e.g.
  // stdio MCP servers) run outside the workspace sandbox, so they stay
  // unconfined and always require per-call approval.
  const confinement: SandboxMode = (input.isNative && input.executionMode !== 'sandbox') || input.externalUnconfined
    ? 'danger-full-access'
    : 'workspace-write'

  return { kind, confinement }
}

const SANDBOX_SUMMARY: Record<SandboxMode, string> = {
  'read-only': 'read-only: writes and execution are refused',
  'workspace-write': 'workspace-write: changes stay inside the authorized workspace',
  'danger-full-access': 'unconfined: the operation can reach the whole machine'
}

/** One-line policy description for logs and the model-facing guidance. */
export function describeExecutionPolicy(policy: ExecutionPolicy): string {
  return `sandbox=${policy.sandbox} (${SANDBOX_SUMMARY[policy.sandbox]}), approval=${policy.approval}`
}
