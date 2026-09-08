/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { isProtectedWorkspacePath } from './workspaceAgentPolicy.ts'

const MAX_BYTES = 128 * 1024 * 1024
const MAX_FILES = 10000
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
export async function readRegular(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_BYTES) throw new Error('Sandbox files must be bounded regular files, not links')
    const buffer = Buffer.alloc(Math.min(info.size + 1, MAX_BYTES + 1))
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > info.size) throw new Error('File changed while reading sandbox snapshot')
    return buffer.subarray(0, offset)
  } finally { await file.close() }
}
export async function scanSandboxFiles(root: string, rejectLinks = false) {
  const files = new Map<string, { hash: string; bytes: Buffer; mode: number }>()
  let total = 0, entriesSeen = 0
  async function visit(directory: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++entriesSeen > MAX_FILES) throw new Error('Sandbox workspace exceeds 10000 entries')
      const path = resolve(directory, item.name), name = relative(root, path)
      if (isProtectedWorkspacePath(name)) continue
      if (item.isSymbolicLink()) {
        if (rejectLinks) throw new Error(`Sandbox output contains a symbolic link: ${name}`)
        continue
      }
      if (item.isDirectory()) await visit(path)
      else if (item.isFile()) {
        const info = await lstat(path)
        const bytes = await readRegular(path)
        total += bytes.length
        if (total > MAX_BYTES) throw new Error('Sandbox workspace exceeds 128 MiB')
        files.set(name, { hash: hash(bytes), bytes, mode: info.mode & 0o777 })
      } else if (rejectLinks) throw new Error(`Unsupported sandbox output: ${name}`)
    }
  }
  await visit(root)
  return files
}
export async function createSandboxSnapshot(root: string) {
  root = await realpath(root)
  const directory = await realpath(await mkdtemp(resolve(tmpdir(), 'gllm-sandbox-')))
  const work = resolve(directory, 'work'), scratch = resolve(directory, 'tmp')
  try {
    const before = await scanSandboxFiles(root)
    await mkdir(work, { mode: 0o700 }); await mkdir(scratch, { mode: 0o700 })
    for (const [name, entry] of before) {
      const path = resolve(work, name)
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const file = await open(path, 'wx', entry.mode)
      try { await file.writeFile(entry.bytes) } finally { await file.close() }
    }
    return { directory, work, scratch, before, root }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
export async function applySandboxSnapshot(snapshot: Awaited<ReturnType<typeof createSandboxSnapshot>>) {
  const after = await scanSandboxFiles(snapshot.work, true)
  const changed = [...after].filter(([name, entry]) => snapshot.before.get(name)?.hash !== entry.hash)
  const deleted = [...snapshot.before.keys()].filter(name => !after.has(name))
  async function target(name: string) {
    const path = resolve(snapshot.root, name), diff = relative(snapshot.root, path)
    if (isAbsolute(diff) || diff.startsWith('..') || isProtectedWorkspacePath(name)) throw new Error('Unsafe sandbox output path')
    let parent = dirname(path)
    while (parent !== snapshot.root) {
      try { if ((await lstat(parent)).isSymbolicLink()) throw new Error('Workspace parent became a symbolic link') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      parent = dirname(parent)
    }
    if (await realpath(snapshot.root) !== snapshot.root) throw new Error('Workspace root changed')
    return path
  }
  // Validate every conflict before applying any result. Never clobber concurrent edits.
  for (const name of [...changed.map(([name]) => name), ...deleted]) {
    const path = await target(name)
    let current: string | undefined
    try { current = hash(await readRegular(path)) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (current !== snapshot.before.get(name)?.hash) throw new Error(`Workspace changed during execution: ${name}; sandbox changes were not applied`)
  }
  for (const [name, entry] of changed) {
    const path = await target(name)
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.gllm-${createHash('sha256').update(snapshot.directory).digest('hex').slice(0, 12)}`
    const file = await open(temp, 'wx', entry.mode & 0o777)
    try { await file.writeFile(entry.bytes) } finally { await file.close() }
    try { await rename(temp, path) } finally { await rm(temp, { force: true }) }
  }
  for (const name of deleted) await unlink(await target(name))
}
