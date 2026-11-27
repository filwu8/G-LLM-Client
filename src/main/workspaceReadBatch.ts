/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

/**
 * Read-only tool calls issued together in one turn are independent of each
 * other: reading three files one after another spends three round trips of I/O
 * waiting on the same disk. Codex-style agents run them at once.
 *
 * The safety rule that makes this possible is the *prefix* rule: only the run
 * of read-only calls at the very start of a turn is batched, and batching stops
 * at the first call that can write. A model that issues [read a, write a] would
 * otherwise have its read executed against the pre-write file, and silently
 * hand the model stale content it believes it just changed. Everything after
 * the first side effect stays strictly ordered.
 */

/** Tools with no side effect on the workspace or the outside world. */
export const PARALLEL_READ_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'read_files',
  'read_document',
  'search_text',
  'list_directory',
  'inspect_file',
  'git_read'
])

/** More than this at once competes for the same disk and gains nothing. */
export const MAX_PARALLEL_READS = 4

export interface ReadBatchCall {
  id: string
  name: string
  arguments: string
}

export interface ReadBatchCandidate {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ReadBatchOptions {
  limit?: number
  /** Call ids already executed in this task; replaying them is not work. */
  skipIds?: ReadonlySet<string>
  /**
   * Everything the batch cannot decide on its own: is the tool enabled here,
   * would an approval rule or an earlier rejection gate this call. A call that
   * is not clearly free to run unattended is left to the serial path, which
   * asks the user.
   */
  eligible?: (candidate: ReadBatchCandidate) => boolean
}

/**
 * The leading run of read-only calls worth executing concurrently.
 *
 * Returns an empty list for a single call: there is nothing to overlap, and a
 * batch of one would only add a second execution path. A call whose arguments
 * are not a JSON object is also skipped — it would fail afterwards anyway, and
 * it must fail through the path that reports it.
 */
export function selectLeadingReadBatch(
  calls: readonly ReadBatchCall[],
  options: ReadBatchOptions = {}
): ReadBatchCandidate[] {
  const limit = Math.max(2, options.limit ?? MAX_PARALLEL_READS)
  const batch: ReadBatchCandidate[] = []
  for (const call of calls) {
    if (batch.length >= limit) break
    if (!PARALLEL_READ_TOOLS.has(call.name)) break
    if (options.skipIds?.has(call.id)) break
    let parsed: unknown
    try {
      parsed = JSON.parse(call.arguments || '{}')
    } catch {
      break
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) break
    const candidate: ReadBatchCandidate = { id: call.id, name: call.name, args: parsed as Record<string, unknown> }
    if (options.eligible && !options.eligible(candidate)) break
    batch.push(candidate)
  }
  return batch.length > 1 ? batch : []
}

export type ConcurrentOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown }

/**
 * Run `run` over `items` with at most `limit` in flight, preserving input order
 * in the result. A rejection is captured per item instead of aborting the
 * batch: one unreadable file must not cancel the reads that would have worked.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>
): Promise<ConcurrentOutcome<R>[]> {
  const results: ConcurrentOutcome<R>[] = new Array(items.length)
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  let next = 0
  const worker = async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      try {
        results[index] = { ok: true, value: await run(items[index], index) }
      } catch (error) {
        results[index] = { ok: false, error }
      }
    }
  }
  await Promise.all(Array.from({ length: width }, worker))
  return results
}
