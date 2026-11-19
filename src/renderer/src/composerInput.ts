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
  // An immediate write supersedes anything still queued for this key.
  const queued = pendingDraftWrites.get(storageKey)
  if (queued) {
    window.clearTimeout(queued.timer)
    pendingDraftWrites.delete(storageKey)
  }
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

/*
 * localStorage.setItem is synchronous and runs on the typing path. One trailing
 * write per 250ms keeps the draft just as durable without stalling each keystroke.
 */
const DRAFT_WRITE_DELAY = 250
const pendingDraftWrites = new Map<string, { value: string; timer: number }>()

export function scheduleComposerDraftPersist(storageKey: string, value: string) {
  const pending = pendingDraftWrites.get(storageKey)
  if (pending) window.clearTimeout(pending.timer)
  const timer = window.setTimeout(() => {
    pendingDraftWrites.delete(storageKey)
    persistComposerDraft(storageKey, value)
  }, DRAFT_WRITE_DELAY)
  pendingDraftWrites.set(storageKey, { value, timer })
}

export function flushComposerDraftPersist(storageKey?: string) {
  for (const [key, pending] of [...pendingDraftWrites]) {
    if (storageKey && key !== storageKey) continue
    window.clearTimeout(pending.timer)
    pendingDraftWrites.delete(key)
    persistComposerDraft(key, pending.value)
  }
}

if (typeof window !== 'undefined') {
  // A reload or window close must not swallow the last few characters.
  window.addEventListener('beforeunload', () => flushComposerDraftPersist())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushComposerDraftPersist()
  })
}

let resizeFrame = 0

/**
 * Textarea auto-grow forces a synchronous layout. Coalescing it into the next
 * animation frame turns a burst of keystrokes into a single measurement instead
 * of one forced reflow per keystroke.
 */
export function resizeComposerTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame)

  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0
    if (!textarea.isConnected) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  })
}

export function formatSelectionAsQuote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
