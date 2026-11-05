/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
export function gllmRetryAt(retryAfter: string | null | undefined, now = Date.now()): number {
  const value = retryAfter?.trim() ?? ''
  const serverTime = /^\d+$/.test(value) ? now + Number(value) * 1000 : Date.parse(value)
  const fallback = now + 30_000
  return Number.isFinite(serverTime) && serverTime <= 8.64e15 ? Math.max(fallback, serverTime) : fallback
}
