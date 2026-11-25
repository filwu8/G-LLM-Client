/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * MCP launch commands, shared by the main process and the settings UI.
 *
 * A stdio MCP server is stored as a command line, but the client needs a
 * program plus an argument vector. Both directions have to agree, because the
 * settings form can only show one string: if it cannot re-render the argument
 * vector it was given, saving an edit silently drops the arguments.
 *
 * This module is deliberately free of Node and Electron imports so the
 * renderer can use it too.
 */

export function parseMcpCommandLine(commandLine: string): { command: string; args: string[] } {
  const input = String(commandLine ?? '').trim()
  if (!input) return { command: '', args: [] }

  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let hasToken = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quote) {
      if (ch === quote) {
        quote = null
      } else if (ch === '\\' && quote === '"' && i + 1 < input.length && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[i + 1]
        i += 1
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      hasToken = true
      continue
    }
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    if (ch === '\\' && i + 1 < input.length && /\s/.test(input[i + 1])) {
      current += input[i + 1]
      hasToken = true
      i += 1
      continue
    }
    current += ch
    hasToken = true
  }

  if (quote) {
    throw new Error('MCP 命令包含未闭合的引号')
  }
  if (hasToken) {
    tokens.push(current)
  }

  return {
    command: tokens[0] ?? '',
    args: tokens.slice(1)
  }
}

/** Quote one token so {@link parseMcpCommandLine} reads it back unchanged. */
function quoteMcpToken(value: string): string {
  // Bare tokens are only safe while they contain nothing the parser treats
  // specially: whitespace splits, and a leading quote would open a quote block.
  if (value.length > 0 && !/[\s"']/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Render a program and its arguments back into a single editable line.
 *
 * The round trip through {@link parseMcpCommandLine} is exact, which is what
 * lets the settings form round-trip a saved server without losing arguments.
 */
export function formatMcpCommandLine(command: string, args: readonly string[] = []): string {
  return [command, ...args].map(quoteMcpToken).join(' ').trim()
}

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
