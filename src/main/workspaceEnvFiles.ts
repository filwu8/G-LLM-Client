/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { assertWorkspacePathAllowed, isProtectedWorkspacePath } from './workspaceAgentPolicy.ts'

export function isPrivateEnvFile(path: string): boolean {
  const name = basename(path)
  return /^\.env(?:\..*)?$/i.test(name) && isProtectedWorkspacePath(name)
}

/** Resolve metadata / new-template access, without granting content access. */
export async function resolveWorkspaceEnvFile(root: string, input: string): Promise<string> {
  if (isAbsolute(input) || !isPrivateEnvFile(input)) throw new Error('Expected a relative .env file path')
  const rootReal = await realpath(root)
  const requested = resolve(rootReal, input)
  const diff = relative(rootReal, requested)
  if (diff === '..' || diff.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(diff)) throw new Error('Path is outside the workspace')
  assertWorkspacePathAllowed(dirname(diff))
  const parent = await realpath(dirname(requested))
  const parentDiff = relative(rootReal, parent)
  if (parentDiff === '..' || parentDiff.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(parentDiff)) throw new Error('Path is outside the workspace')
  assertWorkspacePathAllowed(parentDiff)
  const target = resolve(parent, basename(requested))
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Symbolic links are not allowed for .env metadata or creation')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return target
}

export async function inspectWorkspaceEnvFile(root: string, path: string) {
  const target = await resolveWorkspaceEnvFile(root, path)
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed for .env metadata')
    return { path, exists: true, type: info.isDirectory() ? 'directory' : 'file', size: info.size, modifiedAt: info.mtime.toISOString(), contentProtected: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { path, exists: false, contentProtected: true }
    throw error
  }
}

export function assertEmptyEnvTemplate(content: string): void {
  if (Buffer.byteLength(content) > 65_536) throw new Error('.env template exceeds 64 KB')
  for (const line of content.split(/\r?\n/)) {
    if (!/^\s*(?:#.*)?$/.test(line) && !/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:""|''|``)?\s*(?:#.*)?$/.test(line)) {
      throw new Error('Only empty variable assignments and comments are allowed when creating a protected .env template; leave values for the user to fill locally')
    }
  }
}

/** Atomic create-only operation: existing credentials are never read or overwritten. */
export async function createWorkspaceEnvTemplate(root: string, path: string, content: string) {
  assertEmptyEnvTemplate(content)
  const target = await resolveWorkspaceEnvFile(root, path)
  let file
  try {
    file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
    await file.writeFile(content, 'utf8')
    return { path, size: (await file.stat()).size }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('.env already exists; it was not read or overwritten. Ask the user to edit it locally.')
    throw error
  } finally { await file?.close() }
}
