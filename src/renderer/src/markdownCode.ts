/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Text utilities behind the chat code block.
 *
 * They live outside the component so they can be tested without a DOM: the copy
 * button must place the *source* on the clipboard, not the rendered HTML, and a
 * silently wrong result here (a lost newline, an escaped `&gt;`) is exactly the
 * bug users notice only after pasting into a terminal.
 */

/** Fence languages that all mean "this is a shell command". */
const SHELL_FENCE_LANGUAGES = new Set(['sh', 'shell', 'bash', 'zsh', 'console', 'cmd', 'bat', 'powershell', 'ps1', 'ps'])

/** Header label for a fence: shell dialects collapse to `shell`, everything else keeps its name. */
export function codeFenceLabel(language: string | undefined | null): string {
  const normalized = String(language ?? '').trim().toLowerCase()
  if (!normalized) return ''
  return SHELL_FENCE_LANGUAGES.has(normalized) ? 'shell' : normalized
}

interface ElementLike {
  props?: { children?: unknown }
}

function isElementLike(value: unknown): value is ElementLike {
  return typeof value === 'object' && value !== null && 'props' in (value as Record<string, unknown>)
}

/**
 * Flatten a rendered markdown node back to its source text.
 *
 * react-markdown hands a fenced block's contents to the `pre` renderer as an
 * element (or an array of strings and elements), never as one plain string, so
 * the copy payload has to be rebuilt by walking children in order.
 */
export function plainCodeText(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(plainCodeText).join('')
  if (isElementLike(value)) return plainCodeText(value.props?.children)
  return ''
}
