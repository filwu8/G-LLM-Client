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

const reasoningModelVersionPattern = /(^|[^0-9])5\.6(?:$|[^0-9])/

export function supportsReasoningEffort(model: string | ReasoningModelIdentity | null | undefined): boolean {
  if (!REASONING_EFFORT_ENABLED || !model) return false
  const identity = typeof model === 'string' ? model : `${model.id} ${model.name ?? ''}`
  return reasoningModelVersionPattern.test(identity.toLocaleLowerCase())
}
