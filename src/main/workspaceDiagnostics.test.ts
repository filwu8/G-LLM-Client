/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diagnoseWorkspaceExecution } from './workspaceDiagnostics.ts'
test('execution checks exercise Python, shell Python, isolation and writeback without changing business files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gllm-doctor-test-'))
  try {
    await writeFile(join(root, 'business.txt'), 'leave untouched')
    await writeFile(join(root, '.env'), 'TOKEN=diagnostic-must-not-use-this')
    const report = await diagnoseWorkspaceExecution(root, { executionMode: 'sandbox', sandboxNetwork: false })
    for (const id of ['folder', 'python', 'shell', 'writeback', 'isolation']) assert.equal(report.checks.find(check => check.id === id)?.status, 'passed', JSON.stringify(report))
    for (const id of ['dns', 'network']) assert.equal(report.checks.find(check => check.id === id)?.status, 'skipped')
    assert.deepEqual((await readdir(root)).sort(), ['.env', 'business.txt'])
    assert.equal(await readFile(join(root, 'business.txt'), 'utf8'), 'leave untouched')
    assert.doesNotMatch(JSON.stringify(report), /diagnostic-must-not-use-this/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('missing folders fail before running probes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gllm-doctor-missing-'))
  await rm(root, { recursive: true, force: true })
  const report = await diagnoseWorkspaceExecution(root, { executionMode: 'sandbox', sandboxNetwork: false })
  assert.equal(report.checks.length, 1)
  assert.equal(report.checks[0].id, 'folder'); assert.equal(report.checks[0].status, 'failed')
})
