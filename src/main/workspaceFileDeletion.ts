/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

import { assertWorkspacePathAllowed } from './workspaceAgentPolicy.ts'

export type DeletableWorkspaceFile = {
  /** Fully resolved path that will be handed to the OS trash. */
  absolutePath: string
  /** Workspace-relative path, reported back to the model and the user. */
  relativePath: string
  /** Size in bytes, so the deleted payload is verifiable after the fact. */
  size: number
}

function isInside(child: string, root: string): boolean {
  const diff = relative(root, child)
  return diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))
}

/**
 * Validate that a model-supplied path names exactly one deletable file inside
 * the workspace. Everything the caller needs to refuse happens here, before any
 * filesystem mutation, so the deletion itself stays a single short step.
 *
 * Deliberately narrower than the write tools:
 *
 * - Relative paths only. An absolute path means the model is reaching outside
 *   the authorized root, which no approval mode may waive.
 * - Symlinks are refused rather than followed. Deleting "the link" and deleting
 *   "what the link points at" are different operations, and a link that points
 *   outside the workspace would otherwise turn this into an escape hatch.
 * - Directories are refused. Recursive deletion is a different risk class: one
 *   approved call could remove a whole tree, so it must not ride in on a tool
 *   that promises "one file".
 * - Credential paths (.env, .ssh, ...) and git metadata (.git) are refused by
 *   the shared policy, both for the requested spelling and for the resolved
 *   path, so a symlinked parent directory cannot smuggle them in.
 */
export async function resolveDeletableWorkspaceFile(root: string, input: unknown): Promise<DeletableWorkspaceFile> {
  const requested = String(input ?? '').trim()
  if (!requested) throw new Error('必须指定要删除的工作区文件路径')
  if (isAbsolute(requested)) throw new Error('工具只能使用工作区相对路径')
  assertWorkspacePathAllowed(requested)

  const rootReal = await realpath(root)
  const literal = resolve(rootReal, requested)
  // Reject escapes before touching the filesystem: a `../` path should never be
  // reported as "missing", which would read like an ordinary absence.
  if (!isInside(literal, rootReal)) throw new Error('路径超出当前会话工作区')

  let info
  try {
    info = await lstat(literal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`要删除的文件不存在：${requested}`)
    }
    throw error
  }
  if (info.isSymbolicLink()) throw new Error('不能删除符号链接；请先确认链接指向的目标文件')
  if (info.isDirectory()) throw new Error('不能删除目录；delete_file 只删除单个文件')
  if (!info.isFile()) throw new Error('只能删除普通文件')

  const target = await realpath(literal)
  if (!isInside(target, rootReal)) throw new Error('路径超出当前会话工作区')
  // Re-check after resolution: a symlinked parent could still land inside .git.
  assertWorkspacePathAllowed(relative(rootReal, target))

  return { absolutePath: target, relativePath: relative(rootReal, target), size: info.size }
}
