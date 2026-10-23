/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { WorkspaceFileEntry } from '../shared/types'
import { assertWorkspacePathAllowed, isProtectedWorkspacePath } from './workspaceAgentPolicy.ts'

export async function workspaceFilePath(root: string, path = '.'): Promise<string> {
  const canonicalRoot = await realpath(root)
  const target = await realpath(resolve(canonicalRoot, path))
  const diff = relative(canonicalRoot, target)
  if (isAbsolute(diff) || diff === '..' || diff.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('File is outside this workspace')
  assertWorkspacePathAllowed(diff)
  return target
}

export async function listWorkspaceFiles(root: string, path = '.'): Promise<{ entries: WorkspaceFileEntry[]; truncated: boolean }> {
  const canonicalRoot = await realpath(root)
  const directory = await workspaceFilePath(root, path)
  const items = (await readdir(directory, { withFileTypes: true })).filter(item => !item.isSymbolicLink() && !isProtectedWorkspacePath(item.name))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
  const entries: WorkspaceFileEntry[] = []
  for (const item of items.slice(0, 300)) {
    try {
      const file = await workspaceFilePath(canonicalRoot, relative(canonicalRoot, join(directory, item.name)))
      const info = await stat(file)
      if (!info.isDirectory() && !info.isFile()) continue
      entries.push({ name: item.name, relativePath: relative(canonicalRoot, file).replace(/\\/g, '/'), directory: info.isDirectory(), size: info.size, modifiedAt: info.mtimeMs })
    } catch { /* Ignore files removed while refreshing. */ }
  }
  return { entries, truncated: items.length > 300 }
}

export async function importWorkspaceFile(root: string, source: string): Promise<string> {
  const canonicalRoot = await realpath(root)
  if (!(await lstat(source)).isFile()) throw new Error('Only regular files can be imported')
  const original = await realpath(source)
  assertWorkspacePathAllowed(original)
  const diff = relative(canonicalRoot, original)
  if (!isAbsolute(diff) && diff !== '..' && !diff.startsWith('..\\') && !diff.startsWith('../')) {
    assertWorkspacePathAllowed(diff)
    return diff.replace(/\\/g, '/')
  }
  const name = basename(original)
  assertWorkspacePathAllowed(name)
  const incoming = resolve(canonicalRoot, 'incoming')
  await mkdir(incoming, { recursive: true })
  await workspaceFilePath(canonicalRoot, 'incoming')
  // Reject an incoming symlink even when it points inside the workspace.
  if ((await lstat(incoming)).isSymbolicLink()) throw new Error('Import folder cannot be a symbolic link')
  const extension = extname(name), stem = name.slice(0, name.length - extension.length)
  for (let index = 0; index < 10_000; index++) {
    const target = join(incoming, index ? `${stem} (${index})${extension}` : name)
    try {
      await copyFile(original, target, constants.COPYFILE_EXCL)
      return relative(canonicalRoot, target).replace(/\\/g, '/')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  throw new Error('Too many files with the same name')
}
