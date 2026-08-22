/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
