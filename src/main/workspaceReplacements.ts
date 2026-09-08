/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { randomUUID } from 'node:crypto'
import { open, rename, rm, realpath } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { repositoryPath, repositoryText } from './workspaceRepository.ts'
import { integerOption } from './workspaceOutputStore.ts'
interface PlannedFile { path: string; version: string; text: string; mode: number; bom: boolean; replacements: number }
interface Plan { root: string; files: PlannedFile[]; preview: string }
/** Explicit literal replacements, immutable per-run plans; no implicit glob expansion. */
export class WorkspaceReplacements {
  private plans = new Map<string, Plan>()
  async preview(root: string, args: Record<string, unknown>, signal?: AbortSignal) {
    root = await realpath(root)
    if (!Array.isArray(args.edits) || !args.edits.length || args.edits.length > 32) throw new Error('Provide 1–32 explicit text edits')
    if (Buffer.byteLength(JSON.stringify(args.edits)) > 64000) throw new Error('Replacement arguments exceed 64 KB')
    const files = new Map<string, PlannedFile>()
    const details: unknown[] = []
    let total = 0, bytes = 0
    for (const value of args.edits) {
      signal?.throwIfAborted()
      if (!value || typeof value !== 'object') throw new Error('Invalid text edit')
      const { path, oldText, newText, expectedMatches } = value as Record<string, unknown>
      if (typeof path !== 'string' || typeof oldText !== 'string' || !oldText.length || typeof newText !== 'string' || oldText === newText) throw new Error('Each edit needs a path, nonempty oldText and a different newText')
      const target = await repositoryPath(root, path), key = process.platform === 'linux' ? target : target.toLowerCase()
      let file = files.get(key)
      if (!file) {
        const original = await repositoryText(root, path)
        bytes += original.bytes
        if (bytes > 8 * 1024 * 1024) throw new Error('Replacement plan exceeds 8 MiB')
        file = { path: relative(root, target), ...original, replacements: 0 }; files.set(key, file)
      }
      const count = file.text.split(oldText).length - 1
      if (count !== integerOption(expectedMatches, 1, 1, 1000)) throw new Error(`Match count for ${JSON.stringify(path)} is ${count}; supply the exact expectedMatches from a read/search`)
      total += count
      if (total > 1000) throw new Error('Replacement plan exceeds 1000 occurrences')
      file.text = file.text.split(oldText).join(newText); file.replacements += count
      if (Buffer.byteLength(file.text) > 8 * 1024 * 1024) throw new Error('Replacement output exceeds 8 MiB per file')
      details.push({ path: file.path, oldText, newText, matches: count })
    }
    if ([...files.values()].reduce((sum, file) => sum + Buffer.byteLength(file.text), 0) > 8 * 1024 * 1024) throw new Error('Replacement output exceeds 8 MiB')
    const id = randomUUID(), preview = JSON.stringify({ planId: id, replacements: total, files: [...files.values()].map(({ path, version, replacements }) => ({ path, version, replacements })), edits: details }, null, 2)
    // Only the most recent preview remains valid; bound retained original/replacement text.
    this.plans.clear(); this.plans.set(id, { root, files: [...files.values()], preview })
    return preview
  }
  review(id: unknown) {
    const plan = this.plans.get(String(id ?? ''))
    if (!plan) throw new Error('Plan missing or expired; preview again')
    return plan.preview
  }
  async commit(root: string, id: unknown, signal?: AbortSignal) {
    root = await realpath(root)
    const plan = this.plans.get(String(id ?? ''))
    if (!plan || plan.root !== root) throw new Error('Plan missing or expired; preview again')
    this.plans.delete(String(id))
    const verify = async (file: PlannedFile) => {
      signal?.throwIfAborted()
      if ((await repositoryText(root, file.path)).version !== file.version) throw new Error(`File changed after preview: ${JSON.stringify(file.path)}; preview again`)
    }
    for (const file of plan.files) await verify(file)
    const changedFiles: string[] = []
    try {
      for (const file of plan.files) {
        await verify(file)
        const target = await repositoryPath(root, file.path), temp = join(dirname(target), `.gllm-edit-${randomUUID()}.tmp`)
        try {
          const handle = await open(temp, 'wx', file.mode & 0o777)
          try { await handle.writeFile((file.bom ? '\uFEFF' : '') + file.text); await handle.sync() } finally { await handle.close() }
          await verify(file)
          if (await repositoryPath(root, file.path) !== target) throw new Error('Path changed after preview')
          await rename(temp, target); changedFiles.push(file.path)
        } finally { await rm(temp, { force: true }) }
      }
      return { output: JSON.stringify({ complete: true, changedFiles }), changedFiles, exitCode: 0 }
    } catch (error) {
      return { output: JSON.stringify({ complete: false, changedFiles, error: error instanceof Error ? error.message : String(error), note: 'Files are replaced atomically one at a time; completed writes are not rolled back.' }), changedFiles, exitCode: 1 }
    }
  }
}
