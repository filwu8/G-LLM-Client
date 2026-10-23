/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
export class StorageTasks {
  private readonly tasks = new Set<symbol>()
  get count(): number { return this.tasks.size }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    const task = Symbol()
    this.tasks.add(task)
    try { return await operation() } finally { this.tasks.delete(task) }
  }
}
