/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { boundaryFromTool, requiresApproval, resolveExecutionPolicy } from './executionPolicy.ts'

export function isProtectedWorkspacePath(path: string): boolean {
  return path.split(/[\\/]/).some((part) => /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.gnupg|\.git|id_rsa|id_ed25519)$/i.test(part) && !/^\.env\.(?:example|sample|template)$/i.test(part))
}

export function assertWorkspacePathAllowed(path: string): void {
  if (!isProtectedWorkspacePath(path)) return
  if (path.split(/[\\/]/).some((part) => part.toLowerCase() === '.git')) {
    throw new Error('这是 Git 仓库元数据，普通文件工具不能读取 .git 目录。请改用 git_read 工具（operation: status / log / diff / branch / remote / show）查看仓库状态、提交历史和文件差异。凭据文件（.env / .ssh 等）在任何情况下都不可读取。')
  }
  throw new Error('Protected credentials or repository metadata cannot be accessed by workspace file tools')
}

// HTTP statuses safe to replay a model request on. 429 plus transient upstream
// failures (5xx): a gateway may return 500/503 for a momentary backend fault
// (e.g. its own database hiccup). Failing the whole run on the first such
// response would discard completed tool work, so retry these in place.
export const retryableModelStatuses: ReadonlySet<number> = new Set([429, 500, 502, 503, 504])

// Statuses treated as transient for turn-level continuation after HTTP-level
// retries are exhausted. 429 is handled entirely by in-place retries.
export function isTransientModelHttpStatus(status: number | undefined): boolean {
  return status !== undefined && [500, 502, 503, 504].includes(status)
}

// Only explicit, small regular files at the selected root. Never source .env as code.
async function readRootConfig(root: string, name: string, limit: number): Promise<string | undefined> {
  const rootReal = await realpath(root)
  const path = resolve(rootReal, name)
  let file
  try {
    const target = await realpath(path)
    const diff = relative(rootReal, target)
    if (target !== path || isAbsolute(diff) || diff.startsWith('..')) throw new Error(`${name}: symbolic links are not supported`)
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await file.stat()
    if (!info.isFile() || info.size > limit) throw new Error(`${name}: expected a regular file of at most ${limit} bytes`)
    const buffer = Buffer.alloc(limit + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > limit) throw new Error(`${name}: file is too large`)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  } finally {
    await file?.close()
  }
}

export async function loadWorkspaceInstructions(root: string): Promise<string | undefined> {
  return readRootConfig(root, 'AGENTS.md', 32_768)
}

export async function loadWorkspaceEnvironment(root: string): Promise<Record<string, string>> {
  const source = await readRootConfig(root, '.env', 65_536)
  return source === undefined ? {} : Object.fromEntries(Object.entries(parseEnv(source)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

export function normalizeEnvNames(names: unknown): string[] {
  if (!Array.isArray(names)) return []
  return [...new Set(names.filter((name): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)))].slice(0, 32)
}

export function selectWorkspaceEnvironment(values: Record<string, string>, names: string[]): Record<string, string> {
  const selected: Record<string, string> = Object.create(null)
  for (const name of normalizeEnvNames(names)) {
    // Loader/startup controls are not business credentials.
    if (/^(?:PATH|PATHEXT|HOME|SHELL|ENV|BASH_ENV|IFS|CDPATH|NODE_OPTIONS|NODE_PATH|ELECTRON_.*|PYTHON.*|LD_.*|DYLD_.*|COMSPEC|SYSTEMROOT|WINDIR|SYSTEMDRIVE|LOCALAPPDATA|PSMODULEPATH|PSMODULEANALYSISCACHEPATH|TEMP|TMP|TMPDIR)$/i.test(name)) {
      throw new Error(`Environment variable ${name} controls the runtime and cannot be injected`)
    }
    if (!Object.hasOwn(values, name)) throw new Error(`Environment variable ${name} is missing; configure it in Agent settings or .env`)
    selected[name] = values[name]
  }
  return selected
}

export function redactWorkspaceSecrets(text: string, values: Record<string, string>): string {
  let result = text
  for (const secret of [...new Set(Object.values(values))].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTED]')
  }
  return result
}

/**
 * Stable identity for "this operation" used by the rejection ledger. It is
 * deliberately coarse (tool + primary target) so a renamed script cannot slip
 * past a rejection the user already made.
 */
export function approvalSignature(tool: string, target: string): string {
  return `${String(tool ?? '').trim()}:${String(target ?? '').trim()}`
}

/** A previously rejected operation stays blocked in every permission mode. */
export function isRejectedOperation(denied: ReadonlySet<string>, tool: string, target: string): boolean {
  return denied.has(approvalSignature(tool, target))
}

/**
 * Reduce shell command text to a stable class the user would recognise.
 *
 * The rejection ledger answers one question: "is this the same operation the
 * user just refused?" For a shell command the honest answer is the command, not
 * the whole shell. Identifying it by tool name alone collapsed every command
 * into one identity, so a single rejection forced an approval prompt on every
 * later command in the task -- `ls` included. That was a bug, not a safety net.
 *
 * The program plus the first non-flag token is coarse enough that padding with
 * arguments cannot dodge a rejection, and fine enough that unrelated commands
 * stay unrelated. Over-blocking here only costs another prompt; under-blocking
 * would run something silently, so every ambiguity resolves the coarse way.
 */
export function commandIdentity(command: unknown): string {
  const normalized = String(command ?? '').trim().replace(/\s+/g, ' ')
  if (!normalized) return ''
  const [program, ...rest] = normalized.split(' ')
  // The first token that is not a flag names the subcommand. Skipping flags
  // instead of stopping at them is deliberate: it keeps `rm x` and `rm -rf x`
  // in the same class, because a rejected `rm` must keep covering `rm` however
  // the next attempt pads its flags. A command with no subcommand at all
  // (`ls -la`, `git --version`) is identified by the program alone.
  const subcommand = rest.find((token) => !token.startsWith('-'))
  return subcommand ? `${program} ${subcommand}` : program
}

/**
 * Identity of a script operation.
 *
 * A script is identified by its own text, not by the tool that ran it, for the
 * same reason a file write is identified by its path: rejecting one script must
 * not silently disable that tool for the rest of the task. Hashing keeps the
 * checkpoint small and keeps model-authored code out of the checkpoint file.
 */
export function scriptIdentity(code: unknown): string {
  const normalized = String(code ?? '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''
  return `script:${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`
}

/**
 * Identity of the operation being approved or rejected.
 *
 * Every branch has to return something meaningful. The previous implementation
 * read `args.path ?? args.output ?? args.to` for every tool, which is empty for
 * every command-bearing tool because they take `code`. So `run_shell` resolved
 * to the constant `run_shell:`, the ledger could no longer tell one command
 * from another, and a single rejection gated that whole tool for the task.
 *
 * `executedCode` carries the text that will actually run when it differs from
 * `args.code`: a project check is planned into a fixed command, and the plan is
 * what the user is really approving.
 */
export function resolveApprovalTarget(
  tool: string,
  args: Record<string, unknown>,
  executedCode?: string
): string {
  const name = String(tool ?? '').trim()
  const values = args ?? {}
  if (name === 'set_docx_header_image') return String(values.document ?? '').trim()
  if (name === 'git_write') {
    // The operation is part of the identity, not just the repository: once a
    // declined push was recorded, a shared identity also gated the commit and
    // the stage that were supposed to happen before it. Repository and path
    // filter stay in the key so an approval for one repository never covers
    // another.
    return [
      String(values.operation ?? '').trim(),
      String(values.repo ?? '').trim(),
      String(values.path ?? '').trim()
    ].join('│')
  }
  if (name === 'run_project_check') return `check:${String(values.check ?? '').trim()}`
  if (name === 'delegate_to_harness') return String(values.task ?? '').trim().slice(0, 120)
  if (name === 'browser_action') return String(values.url ?? values.action ?? '').trim()

  const code = String(executedCode ?? values.code ?? '')
  if (name === 'run_shell' || name === 'run_computer_command') return commandIdentity(code)
  if (name === 'run_javascript' || name === 'run_python') return scriptIdentity(code)
  if (name === 'start_background') return values.language === 'python' ? scriptIdentity(code) : commandIdentity(code)

  return String(values.path ?? values.output ?? values.to ?? values.file ?? '').trim()
}


/**
 * Whether a tool call needs a per-call decision from the user.
 *
 * The answer is derived from the confinement the call actually runs under, not
 * from guessing what a tool name or script body does. See
 * {@link ./executionPolicy.ts} for the two-axis model and why the axes are kept
 * apart: an unconfined operation stays approval-gated in every mode, which is
 * what stops "full access mode" from silently waiving the write boundary.
 */
export function needsWorkspaceApproval(
  mode: string | undefined,
  isScript: boolean,
  canWrite: boolean,
  isNative = false,
  boundary: { executionMode?: 'sandbox' | 'host'; external?: boolean; externalUnconfined?: boolean; desktop?: boolean } = {}
): boolean {
  // The client confines every dispatch it makes: in-workspace tools are path
  // checked against the authorized root, scripts run in a snapshot copy, and
  // native commands only leave that confinement in host mode — which
  // boundaryFromTool reports as danger-full-access.
  const policy = resolveExecutionPolicy('workspace-write', mode)
  return requiresApproval(policy, boundaryFromTool({
    isScript,
    canWrite,
    isNative,
    executionMode: boundary.executionMode,
    external: boundary.external,
    externalUnconfined: boundary.externalUnconfined,
    desktop: boundary.desktop
  }))
}

export function workspaceApprovalInstructions(mode: string | undefined): string {  const policy = mode === 'full'
    ? 'Full authorization: enabled in-workspace tools, sandbox execution and HTTP extensions run without per-operation approval. Host (unsandboxed) commands still require per-call approval because they can read and write files outside the authorized workspace; this write boundary cannot be waived by any mode. Dedicated computer/browser tools also require per-call approval.'
    : mode === 'auto'
      ? 'Approve for me: workspace tools, restricted JavaScript and configured sandbox Python/Shell (including background jobs) execute automatically. Host commands and HTTP extensions require approval.'
      : 'Ask for approval: file writes, scripts and HTTP extensions require per-operation approval; read-only workspace tools execute directly.'
  return `${policy} Delegating to the embedded Harness engine is gated as code execution: that engine runs its own shell commands, so the approval covers the whole delegated task rather than a previewable command. Dedicated computer and browser tools always require per-call approval, including in full mode. Approval mode does not enable disabled tools, expand workspace permissions, enable networking or variables, or change sandbox/host mode. The client enforces approvals; invoke the appropriate tool instead of asking the user to approve again in chat. Batch replacements still require a preview and version checks in every mode. Permission approval is not a business decision: in every mode, when several reasonable options exist and user intent is ambiguous, ask the user instead of choosing silently. The user can change the mode at any time; the client always applies the mode that is active when each tool call starts, and an operation the user rejected stays blocked.`
}

export async function loadWorkspaceEnvExampleNames(root: string): Promise<string[]> {
  const content = await readRootConfig(root, '.env.example', 65536)
  return normalizeEnvNames(Object.keys(parseEnv(content ?? '')))
}

/**
 * Stable identity of a tool operation, used only for repeated-failure loop
 * detection. Free-text fields such as `purpose` or a stash `message` are
 * deliberately excluded: a model retrying the same stash with a different
 * message must still count as the same failing operation.
 */
export function repeatedFailureSignature(tool: string, argumentsJson: string | undefined): string {
  let args: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(argumentsJson || '{}') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
  } catch {
    // Malformed arguments still get a stable signature from the tool name.
  }
  const stableKeys = ['operation', 'repo', 'path', 'file', 'command', 'cmd', 'mode', 'name', 'id', 'url', 'document', 'output']
  const stable: Record<string, unknown> = {}
  for (const key of stableKeys) {
    if (typeof args[key] === 'string' || typeof args[key] === 'number') stable[key] = args[key]
  }
  return `${String(tool ?? '').trim()}:${JSON.stringify(stable)}`
}

/** Questions one run may ask the user, across every entry point. */
export const MAX_USER_QUESTIONS_PER_RUN = 3

export type UserQuestionAdmission =
  | { admitted: true; signature: string }
  | { admitted: false; reason: 'duplicate'; signature: string }
  | { admitted: false; reason: 'exhausted' }

/**
 * Normalize a free-text question into a signature that survives rewording of
 * the volatile parts only. This is the weak fallback key: a model that rewords
 * the question every turn defeats it, which is why callers should pass a
 * structured blocker code whenever they have one.
 */
export function questionTextSignature(text: string): string {
  return `text:${String(text ?? '')
    .replace(/request[ _-]?id[:=]\s*\S+/gi, '')
    .replace(/\b[0-9a-f]{8,}\b/gi, '')
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 160)}`
}

/**
 * Decide whether a run may ask the user another question.
 *
 * Two independent limits, both of which were missing on the `ask_user` tool
 * path and let one run interrogate the user five times about the same git
 * identity problem: a hard cap per run, and one question per underlying
 * blocker. A repeated blocker is refused rather than re-asked, because a second
 * identical question tells the user nothing new — the run is looping, not
 * progressing.
 *
 * The blocker code is the primary key. When the model omits it, the normalized
 * question text is used instead, so a verbatim retry is still caught.
 */
export function admitUserQuestion(
  askedSignatures: Set<string>,
  askedCount: number,
  blocker: string | undefined,
  questionText: string
): UserQuestionAdmission {
  if (askedCount >= MAX_USER_QUESTIONS_PER_RUN) return { admitted: false, reason: 'exhausted' }
  const code = String(blocker ?? '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 80)
  const signature = code ? `blocker:${code}` : questionTextSignature(questionText)
  if (askedSignatures.has(signature)) return { admitted: false, reason: 'duplicate', signature }
  return { admitted: true, signature }
}

/**
 * Failure counter keyed by operation signature. A success for the same
 * operation clears its streak; unrelated successful reads never do, so a model
 * cannot keep a failing write alive by sprinkling successful reads between
 * retries. Returns the current consecutive failure count (0 after a success).
 */
export function trackOperationOutcome(counts: Map<string, number>, signature: string, succeeded: boolean): number {
  if (succeeded) {
    counts.delete(signature)
    return 0
  }
  const next = (counts.get(signature) ?? 0) + 1
  counts.set(signature, next)
  return next
}

export type WorkspaceFailureHint = 'lock' | 'timeout' | 'permission' | 'generic'

export function workspaceFailureHint(text: string): WorkspaceFailureHint {
  const value = String(text ?? '')
  if (/index\.lock|file exists|another git process/i.test(value)) return 'lock'
  if (/timed?\s*out|timeout|zeitüberschreitung/i.test(value)) return 'timeout'
  if (/permission denied|access denied|ep erm|administrator|unauthori[sz]ed/i.test(value)) return 'permission'
  return 'generic'
}

/**
 * A failing operation can report different symptoms across a streak (e.g. a
 * slow reset times out once, then leaves index.lock and fails with "file
 * exists" twice). Surfacing only the last symptom misleads — "check the
 * network" when the real blocker is a stale lock. Keep the most actionable
 * hint seen during the whole streak instead. Priority: lock is concrete and
 * directly fixable, so it outranks the vaguer timeout/permission symptoms.
 */
const FAILURE_HINT_PRIORITY: Record<WorkspaceFailureHint, number> = {
  lock: 4,
  permission: 3,
  timeout: 2,
  generic: 1
}

export function mergeFailureHint(current: WorkspaceFailureHint | undefined, next: WorkspaceFailureHint | undefined): WorkspaceFailureHint | undefined {
  if (!current) return next
  if (!next) return current
  return FAILURE_HINT_PRIORITY[next] > FAILURE_HINT_PRIORITY[current] ? next : current
}

/**
 * A tool interrupted mid side effect is a resume warning, not a permanent
 * lock. Returning a note here means the caller should show it to the model and
 * clear the flag; returning undefined means nothing needs verification.
 */
export function resumedToolWarning(
  restored: boolean,
  pendingTool: string | undefined,
  format: (tool: string) => string
): string | undefined {
  return restored && pendingTool ? format(pendingTool) : undefined
}
