/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Windows briefly locks files (antivirus, search indexer, sync clients), so the
 * atomic rename inside electron-store can throw a transient EPERM/EBUSY/EBUSY.
 * Such a lock is harmless and must not discard a completed agent run.
 */
export function isTransientStoreWriteError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'EMFILE' || code === 'ENFILE'
}

function syncBackoff(ms: number): void {
  if (ms <= 0) return
  const shared = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(shared, 0, 0, ms)
}

/** Retry delays in ms. First write is immediate; later ones back off. */
export const STORE_WRITE_RETRY_DELAYS = [0, 40, 120, 350, 800, 1500]

/**
 * Run a synchronous store write, retrying transient OS file locks. Non-lock
 * errors propagate immediately. After all attempts the last lock error is thrown.
 */
export function withStoreWriteRetry<T>(
  write: () => T,
  delays: readonly number[] = STORE_WRITE_RETRY_DELAYS
): T {
  let lastError: unknown
  for (const delay of delays) {
    syncBackoff(delay)
    try { return write() }
    catch (error) {
      if (!isTransientStoreWriteError(error)) throw error
      lastError = error
    }
  }
  throw lastError
}
