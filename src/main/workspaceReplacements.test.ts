/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile, symlink, stat, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { WorkspaceReplacements } from './workspaceReplacements.ts'
const edit = (path: string, oldText = 'old', newText = 'new', expectedMatches = 1) => ({ path, oldText, newText, expectedMatches })
test('preview is read-only, exact replacement commits once and preserves BOM, CRLF, trailing newline and executable mode', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-edits-')), plans = new WorkspaceReplacements()
  try {
    await writeFile(resolve(root, 'a.txt'), '\uFEFFold\r\nold\r\n'); await chmod(resolve(root, 'a.txt'), 0o755)
    await writeFile(resolve(root, 'b.txt'), 'old')
    await assert.rejects(plans.preview(root, { edits: [edit('a.txt')] }), /Match count/)
    const preview = JSON.parse(await plans.preview(root, { edits: [edit('a.txt', 'old', 'new', 2), edit('b.txt')] }))
    assert.equal(await readFile(resolve(root, 'a.txt'), 'utf8'), '\uFEFFold\r\nold\r\n')
    assert.match(plans.review(preview.planId), /new/)
    const result = await plans.commit(root, preview.planId)
    assert.equal(result.exitCode, 0); assert.deepEqual(result.changedFiles, ['a.txt', 'b.txt'])
    assert.equal(await readFile(resolve(root, 'a.txt'), 'utf8'), '\uFEFFnew\r\nnew\r\n')
    assert.equal(await readFile(resolve(root, 'b.txt'), 'utf8'), 'new')
    if (process.platform !== 'win32') assert.equal((await stat(resolve(root, 'a.txt'))).mode & 0o777, 0o755)
    await assert.rejects(plans.commit(root, preview.planId), /expired/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('a conflict in any file blocks all writes; plans are local and newer previews invalidate older ones', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-edits-')), plans = new WorkspaceReplacements()
  try {
    for (const file of ['a.txt', 'b.txt']) await writeFile(resolve(root, file), 'old')
    const first = JSON.parse(await plans.preview(root, { edits: [edit('a.txt'), edit('b.txt')] }))
    assert.throws(() => new WorkspaceReplacements().review(first.planId), /expired/)
    await writeFile(resolve(root, 'b.txt'), 'user edit')
    await assert.rejects(plans.commit(root, first.planId), /changed after preview/)
    assert.equal(await readFile(resolve(root, 'a.txt'), 'utf8'), 'old')
    assert.equal(await readFile(resolve(root, 'b.txt'), 'utf8'), 'user edit')
    const second = JSON.parse(await plans.preview(root, { edits: [edit('a.txt')] }))
    await plans.preview(root, { edits: [edit('a.txt')] })
    await assert.rejects(plans.commit(root, second.planId), /expired/)
    await assert.rejects(plans.preview(root, { edits: [edit('.env')] }), /protected|credential/i)
    if (process.platform !== 'win32') {
      await symlink(resolve(root, 'a.txt'), resolve(root, 'link.txt'))
      await assert.rejects(plans.preview(root, { edits: [edit('link.txt')] }), /links/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
