/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export const REASONING_EFFORT_ENABLED: boolean = true

interface ReasoningModelIdentity {
  id: string
  name?: string
}

const reasoningModelPattern = /^gpt-(?:6-astra|5\.4(?:-(?:mini|nano|pro))?|5\.5(?:-pro)?|5\.6(?:-(?:sol|terra|luna))?)(?:-\d{4}-\d{2}-\d{2})?$/i

export function supportsReasoningEffort(model: string | ReasoningModelIdentity | null | undefined): boolean {
  if (!REASONING_EFFORT_ENABLED || !model) return false
  if (typeof model === 'string') return reasoningModelPattern.test(model.trim())
  return reasoningModelPattern.test(model.id.trim()) || reasoningModelPattern.test(model.name?.trim() ?? '')
}
