/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { realpath } from 'node:fs/promises'
export const workspaceRunLocks = new Map<string, string>()
export async function withWorkspaceImport<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const canonical = await realpath(root)
  const key = process.platform === 'linux' ? canonical : canonical.toLocaleLowerCase()
  if (workspaceRunLocks.has(key)) throw new Error('此工作空间正在执行任务，请结束后再添加文件 / Workspace is busy; add files after the running task finishes')
  workspaceRunLocks.set(key, 'file-import')
  try { return await operation() }
  finally { workspaceRunLocks.delete(key) }
}
