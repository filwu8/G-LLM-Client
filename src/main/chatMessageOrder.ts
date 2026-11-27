/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Message-list shaping that every Chat Completions request goes through.
 *
 * The OpenAI schema allows a system message anywhere, but several gateways in
 * the wild reject it: `could not encode request: System message must be at the
 * beginning`. That 400 kills the whole run — the user sees a task that failed
 * for no visible reason, on the first turn.
 *
 * The client legitimately produces late system messages: a permission-mode
 * switch mid-run, a recovered checkpoint note, a web observation folded into a
 * resumed conversation. Those are temporal notes about the current state, so a
 * user turn is both protocol-safe and semantically right — they belong in the
 * stream at the point they happened, not hoisted to the front where they would
 * read as a standing instruction.
 */

const CLIENT_NOTE_PREFIX = '[客户端提示] '

type RoleMessage = { role: string; content: unknown }

/**
 * Turn every system message that is not part of the leading run into a user
 * note, in place. Leading system messages are left untouched: that is the shape
 * every provider accepts, and rewriting them would churn prompt caches.
 *
 * Returns the same array when nothing needs changing, so hot paths can skip the
 * allocation.
 */
export function demoteLateSystemMessages<T extends RoleMessage>(messages: T[]): T[] {
  const firstNonSystem = messages.findIndex((message) => message.role !== 'system')
  const leadingEnd = firstNonSystem < 0 ? messages.length : firstNonSystem
  if (!messages.some((message, index) => index >= leadingEnd && message.role === 'system')) return messages
  return messages.map((message, index) =>
    index >= leadingEnd && message.role === 'system'
      ? { ...message, role: 'user', content: withClientNotePrefix(message.content) }
      : message
  )
}

function withClientNotePrefix(content: unknown): unknown {
  if (typeof content !== 'string') return content
  if (content.startsWith(CLIENT_NOTE_PREFIX.trim())) return content
  return `${CLIENT_NOTE_PREFIX}${content}`
}

/**
 * A permission-mode switch that happens while a run is in flight.
 *
 * This used to be a system message appended after the conversation, which is
 * exactly what strict gateways reject. It is a note about the present moment,
 * so it travels as a user turn — same channel as `[客户端验收检查]`.
 */
export function permissionModeNote(mode: string): { role: 'user'; content: string } {
  const label = mode === 'full' ? '完全访问权限' : mode === 'auto' ? '帮我批准' : '请求批准'
  return {
    role: 'user',
    content: `[客户端提示] 权限模式已切换：当前是${label}。后续工具调用按新模式判定；已被用户拒绝的操作仍不得执行，需要重新获得明确批准。`
  }
}
