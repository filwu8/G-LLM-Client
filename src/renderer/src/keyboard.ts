/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { MessageSendShortcut } from '@shared/types'

interface KeyboardLikeEvent {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  keyCode?: number
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
  }
}

export function getMessageSendShortcutLabel(shortcut: MessageSendShortcut = 'enter'): string {
  return shortcut === 'ctrl-enter' ? 'Ctrl/Command + Enter' : 'Enter'
}

export function shouldSendMessageFromKeyboard(
  event: KeyboardLikeEvent,
  shortcut: MessageSendShortcut = 'enter'
): boolean {
  if (event.key !== 'Enter') return false
  if (event.nativeEvent?.isComposing || event.nativeEvent?.keyCode === 229 || event.keyCode === 229) return false

  if (event.ctrlKey || event.metaKey) return true
  if (shortcut === 'ctrl-enter') return false

  return !event.shiftKey && !event.altKey
}
