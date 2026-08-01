/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export const GOLD_THEME_REVIEW_REQUEST_COUNT = 10

export interface GoldThemeEligibility {
  eligible: boolean
  reviewComplete: boolean
  totalRequests: number
  officialRequests: number
  officialRequestRatio: number
}

function sanitizeRequestCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function evaluateGoldThemeEligibility(
  totalRequests: number,
  officialRequests: number
): GoldThemeEligibility {
  const total = sanitizeRequestCount(totalRequests)
  const official = Math.min(total, sanitizeRequestCount(officialRequests))
  const officialRequestRatio = total > 0 ? official / total : 0
  const reviewComplete = total >= GOLD_THEME_REVIEW_REQUEST_COUNT

  return {
    eligible: !reviewComplete || officialRequestRatio > 0.5,
    reviewComplete,
    totalRequests: total,
    officialRequests: official,
    officialRequestRatio
  }
}
