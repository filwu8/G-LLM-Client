/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export interface MessageSelectionSnapshot {
  text: string
  html: string
}

export async function writePlainTextToClipboard(text: string) {
  await navigator.clipboard.writeText(text)
}

export async function writeRichTextToClipboard(snapshot: MessageSelectionSnapshot) {
  const text = snapshot.text.trim()
  if (!text) return

  if (snapshot.html.trim() && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([snapshot.html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })
    ])
    return
  }

  await navigator.clipboard.writeText(text)
}

export function getMessageSelectionSnapshot(messageElement: Element | null): MessageSelectionSnapshot | null {
  const selection = window.getSelection()
  const text = selection?.toString().trim() ?? ''
  if (!messageElement || !selection || selection.rangeCount === 0 || !text) return null

  const anchorInside = selection.anchorNode ? messageElement.contains(selection.anchorNode) : false
  const focusInside = selection.focusNode ? messageElement.contains(selection.focusNode) : false
  if (!anchorInside || !focusInside) return null

  const fragment = document.createDocumentFragment()
  for (let index = 0; index < selection.rangeCount; index += 1) {
    fragment.append(selection.getRangeAt(index).cloneContents())
  }

  const container = document.createElement('div')
  container.append(fragment)

  return {
    text,
    html: container.innerHTML
  }
}
