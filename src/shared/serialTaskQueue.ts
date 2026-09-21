/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export function createSerialTaskQueue() {
  let previousTask = Promise.resolve()

  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = previousTask.then(task)
    previousTask = result.then(() => undefined, () => undefined)
    return result
  }
}
