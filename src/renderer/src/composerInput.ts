/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export const MAIN_COMPOSER_DRAFT_KEY = 'gllm:main-composer-draft:v1'
export const QUICK_COMPOSER_DRAFT_KEY = 'gllm:quick-composer-draft:v1'

export function getComposerSessionKey(conversationId: string | null | undefined, projectId: string | undefined, assistantId: string): string {
  return conversationId ? `conversation:${conversationId}` : `new:${projectId || 'loading'}:${assistantId}`
}

export function getComposerDraftStorageKey(sessionKey: string): string {
  return `${MAIN_COMPOSER_DRAFT_KEY}:${encodeURIComponent(sessionKey)}`
}

export function readComposerDraft(storageKey: string): string {
  try {
    return window.localStorage.getItem(storageKey) ?? ''
  } catch {
    return ''
  }
}

export function persistComposerDraft(storageKey: string, value: string) {
  try {
    if (value) {
      window.localStorage.setItem(storageKey, value)
    } else {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    // Draft persistence is a convenience feature; input should keep working if storage is unavailable.
  }
}

export function resizeComposerTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return

  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

export function formatSelectionAsQuote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
