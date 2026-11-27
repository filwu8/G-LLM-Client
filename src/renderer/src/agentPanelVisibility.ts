/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Whether the activity panel should collapse because a question just arrived.
 *
 * Questions now render inline at the composer, so a panel that also opened on
 * the same event put two competing surfaces over one conversation, and the
 * panel covered the messages the question was asking about.
 *
 * The rule is "on arrival", not "while present": comparing the id means the
 * effect fires once when a question appears and never again for that same
 * question, so a user who deliberately reopens the panel to watch progress
 * while deciding is not fought by a render loop.
 */
export function shouldCollapseActivityPanelForQuestion(
  previousQuestionId: string | null | undefined,
  currentQuestionId: string | null | undefined
): boolean {
  const current = String(currentQuestionId ?? '').trim()
  if (!current) return false
  return current !== String(previousQuestionId ?? '').trim()
}
