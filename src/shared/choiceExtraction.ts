/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Extract "pick one of these" options from an assistant reply so the client can
 * render tappable cards above the composer instead of asking the user to retype
 * an option.
 *
 * Two sources, in priority order:
 *  1. An explicit fenced block the model is told to emit when it needs a decision:
 *       ```choices
 *       请选择下一步
 *       - 方案 A：走 SSH 8202
 *       - 方案 B：继续用 HTTPS
 *       ```
 *  2. Best-effort heuristics for free-form replies ("方案 A … 方案 B …",
 *     "选项 1/2", "Choose one: (a) … (b) …"). Numbered lists only count when the
 *     text also contains an explicit choice cue, so ordinary task lists do not
 *     turn into cards.
 */

export interface PendingChoiceDraft {
  /** Question shown above the options. */
  prompt: string
  /** Short option labels, in the order they appeared. */
  options: string[]
}

const MAX_OPTIONS = 6
const MAX_LABEL_LENGTH = 56
const MAX_PROMPT_LENGTH = 90

const CHOICE_CUE = /(二选一|三选一|请选择|请选一个|请确认方[案式]|选择一项|任选其一|选哪个|choose\s+one|pick\s+one|which\s+option|options?\s+below)/i

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clip(value: string, limit: number): string {
  const text = collapse(value)
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*•]\s+/, '')
    .trim()
}

/** Keep only the short headline of an option, dropping its long description. */
function optionLabel(raw: string): string {
  const cleaned = cleanMarkdown(raw)
  const colon = cleaned.search(/：|:\s/)
  const head = colon > 0 && colon <= 40 ? cleaned.slice(0, colon) : cleaned
  return clip(head, MAX_LABEL_LENGTH)
}

/**
 * Build a label for "方案 A：…" style options: keep the scheme prefix (so the
 * user can map it back to the reply) plus the first short clause of the body.
 */
function schemeLabel(prefix: string, rest: string): string {
  const body = cleanMarkdown(rest)
    .replace(/^[（(][^)）]*[)）]\s*[：:]?\s*/, '')
    .trim()
  const head = body.split(/：|:\s/)[0]
  const concise = clip(head, 30)
  return concise ? `${prefix} · ${concise}` : prefix
}

function uniqueOptions(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    result.push(value)
    if (result.length >= MAX_OPTIONS) break
  }
  return result
}

function parseFencedBlock(text: string): PendingChoiceDraft | null {
  const match = text.match(/```choices\s*\n([\s\S]*?)```/i)
  if (!match) return null
  const lines = match[1].split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return null

  const options: string[] = []
  let prompt = ''
  for (const line of lines) {
    if (/^([-*•]|\d{1,2}[.、．)）])\s+/.test(line)) {
      const body = line.replace(/^([-*•]|\d{1,2}[.、．)）])\s+/, '')
      const scheme = body.match(/^(方案|选项|option)\s*([A-Za-z]|\d{1,2})\s*[：:、.．)）]?\s*(.+)$/i)
      const prefix = scheme
        ? (scheme[1].toLowerCase() === 'option' ? `Option ${scheme[2].toUpperCase()}` : `${scheme[1]} ${scheme[2].toUpperCase()}`)
        : ''
      const label = scheme ? schemeLabel(prefix, scheme[3]) : optionLabel(body)
      if (label) options.push(label)
    } else if (!prompt) {
      prompt = clip(cleanMarkdown(line), MAX_PROMPT_LENGTH)
    }
  }
  if (options.length < 2) return null
  return { prompt: prompt || '请选择下一步', options: uniqueOptions(options) }
}

interface OptionMatch {
  label: string
  index: number
  /** `scheme` matches 方案 A / 选项 2; `plain` matches bare A) / 1. lists. */
  kind: 'scheme' | 'plain'
}

function collectOptions(lines: string[]): OptionMatch[] {
  const matches: OptionMatch[] = []
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length > 400) return
    // Some replies prefix the option with a bracketed instruction, e.g.
    // "【请您二选一】 方案 A：…", so drop that prefix before matching.
    const body = trimmed.replace(/^[【\[（(][^】\]）)]*[】\]）)]\s*/, '')

    const scheme = body.match(/^(方案|选项|option)\s*([A-Za-z]|\d{1,2})\s*[：:、.．)）]?\s*(.+)$/i)
    if (scheme) {
      const prefix = scheme[1].toLowerCase() === 'option'
        ? `Option ${scheme[2].toUpperCase()}`
        : `${scheme[1]} ${scheme[2].toUpperCase()}`
      const label = schemeLabel(prefix, scheme[3])
      if (label) matches.push({ label, index, kind: 'scheme' })
      return
    }

    const lettered = body.match(/^([A-Za-z])[)）.、．]\s*(.+)$/)
    if (lettered) {
      const label = optionLabel(lettered[2])
      if (label) matches.push({ label, index, kind: 'plain' })
      return
    }

    const numbered = body.match(/^(\d{1,2})[)）.、．]\s*(.+)$/)
    if (numbered) {
      const label = optionLabel(numbered[2])
      if (label) matches.push({ label, index, kind: 'plain' })
    }
  })
  return matches
}

function findPrompt(lines: string[], firstOptionIndex: number, whole: string): string {
  // Bracketed instructions such as "【请您二选一，完成后我立即接手】" read best
  // as the card prompt.
  for (const bracket of whole.matchAll(/【([^】]{2,80})】/g)) {
    if (CHOICE_CUE.test(bracket[1])) return clip(cleanMarkdown(bracket[1]), MAX_PROMPT_LENGTH)
  }
  const cueLine = lines.find((line) => CHOICE_CUE.test(line))
  if (cueLine) {
    const stripped = cleanMarkdown(cueLine.replace(/[【】\[\]]/g, ' ').replace(/\s+/g, ' '))
    const sentence = stripped.split(/[。；;]/)[0]
    if (sentence) return clip(sentence, MAX_PROMPT_LENGTH)
  }
  for (let index = firstOptionIndex - 1; index >= 0; index -= 1) {
    const candidate = collapse(lines[index] ?? '')
    if (candidate.length < 4) continue
    if (/[:：]$/.test(candidate)) return clip(cleanMarkdown(candidate), MAX_PROMPT_LENGTH)
  }
  const fallback = whole.split(/\r?\n/).map((line) => collapse(line)).find((line) => line.length >= 4)
  return fallback ? clip(cleanMarkdown(fallback), MAX_PROMPT_LENGTH) : '请选择下一步'
}

/**
 * Returns the option set when the reply clearly asks the user to choose, or
 * null when it is an ordinary answer.
 */
export function extractChoicesFromReply(text: string): PendingChoiceDraft | null {
  const source = (text ?? '').trim()
  if (source.length < 24) return null

  const fenced = parseFencedBlock(source)
  if (fenced) return fenced

  const lines = source.split(/\r?\n/)
  const matches = collectOptions(lines)
  if (matches.length < 2) return null

  const hasSchemeOptions = matches.filter((match) => match.kind === 'scheme').length >= 2
  const hasCue = CHOICE_CUE.test(source)
  // Bare "A) … / B) …" or "1. … / 2. …" lists are only treated as a choice when
  // the reply also asks the user to choose; otherwise it is just a list.
  if (!hasSchemeOptions && !hasCue) return null

  const options = uniqueOptions(matches.map((match) => match.label))
  if (options.length < 2) return null

  return {
    prompt: findPrompt(lines, matches[0].index, source),
    options
  }
}
