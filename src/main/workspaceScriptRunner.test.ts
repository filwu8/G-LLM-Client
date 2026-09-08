/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const runner = resolve(process.cwd(), 'resources/workspace-script-runner.cjs')

async function runScript(source: string): Promise<{ status: number | null; stderr: string; root: string }> {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-runner-test-'))
  const script = resolve(root, 'task.js')
  await writeFile(script, source, 'utf8')
  const result = spawnSync(process.execPath, [runner, root, script], { encoding: 'utf8' })
  return { status: result.status, stderr: result.stderr, root }
}

test('isolated scripts cannot disguise UTF-8 text as a Word document', async () => {
  const result = await runScript("await workspace.writeText('invalid.docx', '# text')")
  try {
    assert.equal(result.status, 1)
    assert.match(result.stderr, /不能把 UTF-8 文本写入 \.docx/)
    assert.equal(existsSync(resolve(result.root, 'invalid.docx')), false)
  } finally {
    await rm(result.root, { recursive: true, force: true })
  }
})

test('isolated scripts keep ordinary text output available', async () => {
  const result = await runScript("await workspace.writeText('notes.md', '# valid'); return 'done'")
  try {
    assert.equal(result.status, 0)
    assert.equal(await readFile(resolve(result.root, 'notes.md'), 'utf8'), '# valid')
  } finally {
    await rm(result.root, { recursive: true, force: true })
  }
})

test('workspace API denies credentials even through a differently named symlink', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-runner-secrets-'))
  try {
    await writeFile(resolve(root, '.env'), 'TOKEN=private-fixture-token')
    await symlink(resolve(root, '.env'), resolve(root, 'innocent.txt'))
    for (const file of ['.env', 'innocent.txt']) {
      await writeFile(resolve(root, 'task.js'), `return await workspace.readText(${JSON.stringify(file)})`)
      const result = spawnSync(process.execPath, [runner, root, resolve(root, 'task.js')], { encoding: 'utf8' })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Protected/)
      assert.doesNotMatch(result.stdout + result.stderr, /private-fixture-token/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('workspace API rejects writes and recursive mkdir through escaping symlinks', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-runner-links-'))
  const outside = await mkdtemp(resolve(tmpdir(), 'gllm-runner-outside-'))
  try {
    await writeFile(resolve(outside, 'keep.txt'), 'keep')
    await symlink(resolve(outside, 'keep.txt'), resolve(root, 'link.txt'))
    await symlink(outside, resolve(root, 'directory'))
    for (const code of ["await workspace.writeText('link.txt','bad')", "await workspace.mkdir('directory/new/nested')"]) {
      await writeFile(resolve(root, 'task.js'), code)
      const result = spawnSync(process.execPath, [runner, root, resolve(root, 'task.js')], { encoding: 'utf8' })
      assert.equal(result.status, 1)
    }
    assert.equal(await readFile(resolve(outside, 'keep.txt'), 'utf8'), 'keep')
    assert.equal(existsSync(resolve(outside, 'new')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
