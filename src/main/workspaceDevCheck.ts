/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * The client's own "did the code still work" gate.
 *
 * A coding task is not finished because the model says it is finished: it is
 * finished when the project's own check passes *after* the last source edit.
 * Everything in this module is pure so the policy can be tested without a model
 * or a shell — the agent loop decides when to run it, this file decides what
 * counts as verified.
 */

/** Checks the client is willing to require on its own, cheapest first. */
export const AUTO_CHECK_ORDER = ['typecheck', 'test'] as const
export type AutoCheck = (typeof AUTO_CHECK_ORDER)[number]

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.astro',
  '.py', '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.swift',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.rb', '.dart',
  '.sh', '.ps1'
])

/**
 * Directories whose contents are generated. A change under them is not a
 * reason to run the project's tests, and counting it would make almost every
 * run look like a code change.
 */
const GENERATED_SEGMENTS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '.next', '.nuxt', 'target', 'vendor', '__pycache__', '.cache'])

const TEST_FILE = /(?:^|\/)(?:[^/]*\.(?:test|spec)\.[^/]+|__tests__\/|tests?\/)/i

function normalized(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isCodeFile(file: string): boolean {
  const path = normalized(file)
  const segments = path.split('/')
  if (segments.some((segment) => GENERATED_SEGMENTS.has(segment.toLowerCase()))) return false
  const dot = path.lastIndexOf('.')
  if (dot <= path.lastIndexOf('/')) return false
  return CODE_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

export function changedCodeFiles(files: Iterable<string>): string[] {
  const seen = new Set<string>()
  for (const file of files) {
    const path = normalized(file)
    if (isCodeFile(path)) seen.add(path)
  }
  return [...seen].sort()
}

export interface DevCheckState {
  /** Source files this task changed, relative to the workspace root. */
  changedFiles: string[]
  /** Check categories the project actually provides (from its manifest). */
  available: string[]
  /** Category → code version at which it last passed. */
  passed: Map<string, number>
  /** Bumped on every source write, so a pass can be tied to "after the edit". */
  codeVersion: number
  /** The user's request, used to decide whether tests are in scope. */
  latestUserRequest?: string
}

/**
 * Which checks must pass before this run may report success.
 *
 * Type checking is required whenever the project provides it: it is cheap next
 * to a test suite and catches the class of breakage an edit introduces most
 * often. Tests are required as well when the change touched tests or the user
 * asked for them — running a full suite after a one-line comment change is a
 * cost the user did not ask for, and it is the fastest way to make an agent
 * feel slow.
 */
export function requiredDevChecks(state: DevCheckState): string[] {
  const codeFiles = changedCodeFiles(state.changedFiles)
  if (codeFiles.length === 0) return []
  const available = new Set(state.available)
  const required = new Set<string>()
  if (available.has('typecheck')) required.add('typecheck')
  const testsInScope = available.has('test') && (
    codeFiles.some((file) => TEST_FILE.test(file)) ||
    /测试|单测|用例|test|spec|vitest|jest|pytest/i.test(state.latestUserRequest ?? '')
  )
  if (testsInScope) required.add('test')
  return AUTO_CHECK_ORDER.filter((category) => required.has(category))
}

/** Required checks that have no passing result at the current code version. */
export function pendingDevChecks(state: DevCheckState): string[] {
  return requiredDevChecks(state).filter((category) => state.passed.get(category) !== state.codeVersion)
}

/** The error lines worth spending context on, not the whole build log. */export function describeCheckFailure(output: string, maxLines = 14): string {
  const lines = output
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0 && !/^Exit code: \d+$/.test(line.trim()))
  const strong = /error\s+TS\d+|^\s*Error:|AssertionError|\bnot ok\b|\bFAIL\b|✗|✘|^\s*[×✕]\s|failed|Cannot find|Unhandled|Uncaught|panic:|Traceback/i
  const hits = lines.filter((line) => strong.test(line))
  const selected = (hits.length > 0 ? hits : lines.slice(-maxLines)).slice(0, maxLines)
  const omitted = lines.length - selected.length
  const body = selected.map((line) => line.slice(0, 300)).join('\n')
  return omitted > 0 ? `${body}\n…（另有 ${omitted} 行输出未显示）` : body
}

export interface DevCheckResult {
  category: string
  label: string
  exitCode: number
  output: string
}

/**
 * Did the check fail, or did it never start?
 *
 * "pnpm is not recognized" is not a red build — it is a missing toolchain, and
 * feeding it back as a code failure sends the model hunting for a bug in the
 * source that does not exist. The gate treats these as "cannot verify" instead.
 */
export function looksLikeMissingToolchain(output: string): boolean {
  return /is not recognized as an internal or external command|command not found|不是内部或外部命令|(?:pnpm|npm|yarn|bun|node|tsc|npx):\s*not found|no such file or directory:\s*\S*(?:pnpm|npm|yarn|bun|node|tsc|npx)|Cannot find module ['"]?(?:typescript|tsc)['"]?|ENOENT: no such file or directory, posix_spawn/i.test(output)
}

/**
 * What the model should hear when a project check cannot start at all.
 *
 * The raw CMD text ("'npm' is not recognized…") reads like a wrong shell, so a
 * real run answered it by trying run_shell, then run_javascript, then another
 * approval prompt — five minutes spent looking for a code bug inside a missing
 * binary. The cause is environmental and no other shell will fix it, so the
 * message says that outright and points at the one useful action: tell the user
 * which command to run, and do not claim process-level verification.
 */
export function missingToolchainMessage(detail: string, isEnglish: boolean): string {
  const first = detail.trim().split(/\r?\n/).find((line) => line.trim())?.slice(0, 200) ?? ''
  return isEnglish
    ? `The project check could not start: its runner is missing (${first}).\nThis is not a failing check, and another shell will not fix it: the package manager or toolchain is not installed, or not on PATH. Neither is it a reason to edit the source. Do not retry the same command through run_shell or run_javascript. Tell the user which command to run in which directory, and state plainly that the result is not verified by a process exit code.`
    : `项目自检没能启动：运行器缺失（${first}）。\n这不是检查失败，换一个 shell 也不会变好：项目需要的包管理器或工具链没有安装，或者不在 PATH 上；也不是改源码能解决的问题。不要用 run_shell 或 run_javascript 反复重试同一条命令。请如实告诉用户需要在哪个目录运行哪条命令，并说明这次结果没有经过进程退出码验证。`
}

function header(language: 'zh' | 'en', attempt: number, limit: number): string {
  return language === 'en'
    ? `[Client verification] The code changed, but the project's own check did not pass, so this turn cannot be reported as complete (attempt ${attempt}/${limit}).`
    : `[客户端自动验证] 你改动了代码，但项目自检没有通过，所以这一轮不能算完成（第 ${attempt}/${limit} 次）。`
}

/**
 * What the model gets back after a failing check.
 *
 * It names the real cause, forbids the two shortcuts that make a red build look
 * green, and — importantly — gives it a legitimate way out when the failure was
 * already there before this task: say so with evidence instead of silently
 * weakening the check.
 */
export function devCheckFeedback(input: {
  language: 'zh' | 'en'
  results: DevCheckResult[]
  attempt: number
  limit: number
}): string {
  const zh = input.language !== 'en'
  const failures = input.results.filter((result) => result.exitCode !== 0)
  const sections = failures.map((result) => [
    `${zh ? '命令' : 'Command'}：${result.label}`,
    `${zh ? '退出码' : 'Exit code'}：${result.exitCode}`,
    describeCheckFailure(result.output)
  ].join('\n'))
  const rules = zh
    ? [
      '1. 按上面的真实原因修复；不要删除、跳过或改写失败的测试来让它变绿，也不要用 any / ts-ignore / eslint-disable 掩盖类型错误。',
      '2. 修完继续任务。客户端会在你下次声明完成之前重新运行这项检查，只有通过才算完成。',
      '3. 如果这个失败与本次改动无关（仓库本来就是红的），用一句话说明它是既有失败，并给出证据：同一命令在改动之前的输出，或者失败的测试文件与本次改动无关的理由。'
    ]
    : [
      '1. Fix the real cause above. Do not delete, skip or rewrite a failing test to make it green, and do not hide a type error behind any / ts-ignore / eslint-disable.',
      '2. Continue the task after fixing. The client re-runs this check before it accepts completion, and only a pass counts.',
      '3. If the failure predates this task (the repository was already red), say so in one sentence and back it up: the same command before your change, or why the failing file is unrelated to this edit.'
    ]
  return `${header(input.language, input.attempt, input.limit)}\n\n${sections.join('\n\n')}\n\n${zh ? '要求：' : 'Requirements:'}\n${rules.join('\n')}`
}

/**
 * Sent instead of running the check when the client may not execute project
 * scripts without a prompt (host mode, or "ask for approval"). The requirement
 * is the same — it just travels through the tool the user already approved,
 * instead of appearing as an unannounced background execution.
 */
export function devCheckRequestMessage(input: {
  language: 'zh' | 'en'
  pending: string[]
  labels: Map<string, string>
  attempt: number
  limit: number
}): string {
  const zh = input.language !== 'en'
  const lines = input.pending.map((category) => `- run_project_check(check: "${category}") — ${input.labels.get(category) ?? category}`)
  const intro = zh
    ? `[客户端完成前检查] 你改动了代码，但在这些改动之后还没有通过项目自检，所以这一轮不能算完成（第 ${input.attempt}/${input.limit} 次）。当前权限模式下，自检脚本必须由你发起、由用户批准，客户端不会替你静默执行。`
    : `[Client verification] The code changed, but no project check has passed since those edits, so this turn cannot be reported as complete (attempt ${input.attempt}/${input.limit}). Under the current approval mode the client will not run a project script on its own; you must request it.`
  const rules = zh
    ? '现在调用下面缺少的检查，按结果修复后继续；不要用删除测试、any 或 ts-ignore 绕过。如果失败是改动之前就存在的，说明这一点并给出证据。'
    : 'Run the missing checks below now, fix what they report, then continue. Do not bypass them by deleting tests or adding any / ts-ignore. If a failure predates this change, say so with evidence.'
  return `${intro}\n${lines.join('\n')}\n\n${rules}`
}

/** One-line evidence appended to the run's verification text. */
export function devCheckSummary(language: 'zh' | 'en', results: DevCheckResult[]): string {
  const passed = results.filter((result) => result.exitCode === 0).map((result) => result.label)
  if (passed.length === 0) return ''
  return language === 'en'
    ? `Client re-ran: ${passed.join(', ')} — passed`
    : `客户端复跑通过：${passed.join('、')}`
}

export function devCheckActivityLabel(language: 'zh' | 'en', category: string): string {
  return language === 'en' ? `Auto-verify ${category}` : `自动验证 ${category}`
}
