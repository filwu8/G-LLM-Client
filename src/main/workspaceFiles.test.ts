/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { importWorkspaceFile, listWorkspaceFiles, workspaceFilePath } from './workspaceFiles.ts'
import { withWorkspaceImport } from './workspaceRunLock.ts'

test('imports preserve original files, avoid overwriting and keep workspace references stable', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'gllm-files-'))
  try {
    const root = join(fixture, 'workspace'); await mkdir(root)
    const source = join(fixture, '合同.txt'); await writeFile(source, 'contract original')
    const first = await importWorkspaceFile(root, source)
    const second = await importWorkspaceFile(root, source)
    assert.notEqual(first, second)
    assert.equal(await readFile(source, 'utf8'), 'contract original')
    assert.equal(await readFile(join(root, first), 'utf8'), 'contract original')
    assert.equal(await importWorkspaceFile(root, join(root, first)), first)
    assert.equal((await listWorkspaceFiles(root, 'incoming')).entries.length, 2)
    await assert.rejects(workspaceFilePath(root, '../合同.txt'), /outside/)
    await writeFile(join(root, '.env'), 'secret')
    await assert.rejects(workspaceFilePath(root, '.env'), /Protected/)
    assert.equal((await listWorkspaceFiles(root)).entries.some(entry => entry.name === '.env'), false)
    await withWorkspaceImport(root, async () => {
      await assert.rejects(withWorkspaceImport(root, async () => {}), /busy/)
    })
    await withWorkspaceImport(root, async () => {})
  } finally { await rm(fixture, { recursive: true, force: true }) }
})

test('an incoming directory junction cannot redirect imported files', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'gllm-file-link-'))
  try {
    const root = join(fixture, 'workspace'), external = join(fixture, 'external')
    await mkdir(root); await mkdir(external)
    const source = join(fixture, 'source.txt'); await writeFile(source, 'original')
    await symlink(external, join(root, 'incoming'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(importWorkspaceFile(root, source), /outside|symbolic link/)
    assert.equal((await listWorkspaceFiles(root)).entries.length, 0)
  } finally { await rm(fixture, { recursive: true, force: true }) }
})
