/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
export function estimateTokenCount(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0

  const cjkCount = normalized.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const nonCjkTokens = normalized.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0
  return Math.max(1, Math.ceil(cjkCount + nonCjkTokens * 0.75))
}
