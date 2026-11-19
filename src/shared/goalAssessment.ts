/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { GoalAssessRequest, GoalAssessResult, GoalChoice } from './types'

/** Maximum number of clarification rounds before the goal is launched with assumptions. */
export const GOAL_CLARIFY_LIMIT = 3

/** Maximum number of clarifying questions surfaced in a single round. */
export const GOAL_MAX_QUESTIONS = 3

/** Maximum number of options offered for a single choice question. */
export const GOAL_MAX_CHOICE_OPTIONS = 6

const approvalKeywords = [
  '授权',
  '权限',
  '批准',
  '允许',
  '工作区',
  '工作目录',
  '文件夹',
  '目录',
  'git 权限',
  'git权限',
  'git 授权',
  'git授权',
  'permission',
  'authoriz',
  'approval',
  'approve',
  'workspace folder',
  'choose a folder',
  'select a folder'
]

/**
 * Normalize a question/option for duplicate detection: lower-case, strip
 * punctuation and whitespace so that light paraphrases and formatting drift
 * still collapse to the same key.
 */
export function normalizeQuestionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[。．.，,、；;：:！!？?（）()\[\]【】{}《》"'“”‘’`~\-—_/\\|*#]/g, '')
    .trim()
}

/**
 * True when a question merely asks about permissions / authorization / the
 * workspace folder. Those are handled automatically by the client, so such a
 * question must never be surfaced to the user (this is the root cause of the
 * "asked for git authorization twice" report).
 */
export function isApprovalQuestion(value: string): boolean {
  const normalized = value.toLowerCase()
  return approvalKeywords.some((keyword) => normalized.includes(keyword))
}

/**
 * True when `candidate` duplicates anything in `answered` — exact after
 * normalization, or one fully contains the other (a common paraphrase shape).
 */
export function isDuplicateQuestion(candidate: string, answered: string[]): boolean {
  const key = normalizeQuestionText(candidate)
  if (!key) return false
  return answered.some((previous) => {
    const other = normalizeQuestionText(previous)
    if (!other) return false
    if (other === key) return true
    // Containment catches light rephrasing / extra clauses around the same ask.
    return key.length >= 4 && other.length >= 4 && (key.includes(other) || other.includes(key))
  })
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asList(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => asText(item)).filter(Boolean).slice(0, limit)
    : []
}

/** Sanitize the structured `choices` array, dropping malformed / duplicate entries. */
export function sanitizeGoalChoices(value: unknown, alreadyAsked: string[]): GoalChoice[] {
  if (!Array.isArray(value)) return []
  const choices: GoalChoice[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const text = asText(record.text)
    const options = Array.from(
      new Set(asList(record.options, GOAL_MAX_CHOICE_OPTIONS))
    ).filter((option) => !isApprovalQuestion(option))
    if (!text || isApprovalQuestion(text) || options.length < 2) continue
    if (isDuplicateQuestion(text, alreadyAsked)) continue
    choices.push({
      text,
      options,
      ...(record.allowsCustom === true ? { allowsCustom: true } : {}),
      ...(record.multiple === true ? { multiple: true } : {})
    })
    if (choices.length >= GOAL_MAX_QUESTIONS) break
  }
  return choices
}

/**
 * Fallback used when the judge is unavailable (no API key, network/parse
 * failure). It deliberately treats the requirement as sufficient so the user
 * is never blocked by the judge itself; the caller records the reason as an
 * assumption / fallback notice.
 */
export function fallbackGoalAssessment(request: GoalAssessRequest, error?: string): GoalAssessResult {
  const goal = request.latestInput.trim()
  return {
    sufficient: true,
    goal,
    acceptanceCriteria: '',
    questions: [],
    choices: [],
    assumptions: [],
    changed: false,
    ...(error ? { error } : {})
  }
}

/**
 * Normalize a raw structured judgment into a safe GoalAssessResult.
 *
 * Beyond type/limit checks this enforces three deterministic guarantees:
 * - Never surface a permission/authorization/workspace question (auto-handled).
 * - Never repeat a question that was already asked in an earlier round.
 * - If every question was filtered out as a duplicate, there is nothing left
 *   to ask, so the goal is treated as sufficient and launches with the
 *   information already gathered instead of trapping the user in a loop.
 */
export function sanitizeGoalAssessment(
  parsed: Record<string, unknown> | null,
  request: GoalAssessRequest
): GoalAssessResult {
  const roundAtLimit = request.round >= GOAL_CLARIFY_LIMIT
  const sourceGoal = request.latestInput.trim()
  const goal = asText(parsed?.goal) || sourceGoal
  const alreadyAsked = (request.alreadyAsked ?? []).filter(Boolean)

  const rawChoices = sanitizeGoalChoices(parsed?.choices, alreadyAsked)
  const choiceTexts = rawChoices.map((choice) => choice.text)

  // Free-text questions: drop approval questions, repeats of prior rounds, and
  // anything already covered by a choice.
  const questions = asList(parsed?.questions, GOAL_MAX_QUESTIONS)
    .filter((question) => !isApprovalQuestion(question))
    .filter((question) => !isDuplicateQuestion(question, alreadyAsked))
    .filter((question) => !isDuplicateQuestion(question, choiceTexts))

  const judgeSaidSufficient = parsed?.sufficient === true
  // Nothing actionable left to ask → do not stall; launch with what we have.
  const nothingToAsk = questions.length === 0 && rawChoices.length === 0
  const sufficient = roundAtLimit || judgeSaidSufficient || (nothingToAsk && !judgeSaidSufficient)

  if (sufficient) {
    return {
      sufficient: true,
      goal,
      acceptanceCriteria: asText(parsed?.acceptanceCriteria),
      scope: asText(parsed?.scope) || undefined,
      constraints: asText(parsed?.constraints) || undefined,
      questions: [],
      choices: [],
      assumptions: asList(parsed?.assumptions, GOAL_MAX_QUESTIONS),
      changed: parsed?.changed === true
    }
  }

  return {
    sufficient: false,
    goal,
    acceptanceCriteria: asText(parsed?.acceptanceCriteria),
    scope: asText(parsed?.scope) || undefined,
    constraints: asText(parsed?.constraints) || undefined,
    questions,
    choices: rawChoices,
    assumptions: asList(parsed?.assumptions, GOAL_MAX_QUESTIONS),
    changed: parsed?.changed === true
  }
}
