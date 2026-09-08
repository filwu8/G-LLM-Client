/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { assertWorkspacePathAllowed } from './workspaceAgentPolicy.ts'
import { assertEmptyEnvTemplate, createWorkspaceEnvTemplate, inspectWorkspaceEnvFile } from './workspaceEnvFiles.ts'
import { verifyWorkspaceArtifacts } from './workspaceArtifactVerification.ts'

test('the requested .env scaffold can be inspected, created and verified without exposing values', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-env-template-'))
  try {
    assert.deepEqual(await inspectWorkspaceEnvFile(root, '.env'), { path: '.env', exists: false, contentProtected: true })
    const content = '# Fill locally\nSERVICE_URL=\nSERVICE_LOGIN=\nSERVICE_API_KEY=\n'
    const created = await createWorkspaceEnvTemplate(root, '.env', content)
    assert.equal(created.size, Buffer.byteLength(content))
    assert.equal((await inspectWorkspaceEnvFile(root, '.env')).exists, true)
    assert.equal((await verifyWorkspaceArtifacts(root, new Set(['.env']), '你帮我创建一个 .env，然后我会自己填写进去')).verifiedFiles, 1)
    if (process.platform !== 'win32') assert.equal((await stat(resolve(root, '.env'))).mode & 0o777, 0o600)
    assert.throws(() => assertWorkspacePathAllowed('.env'), /Protected/)

    await writeFile(resolve(root, '.env'), 'SERVICE_API_KEY=private-fixture-secret')
    const metadata = await inspectWorkspaceEnvFile(root, '.env')
    assert.doesNotMatch(JSON.stringify(metadata), /private-fixture-secret|SERVICE_API_KEY/)
    await assert.rejects(createWorkspaceEnvTemplate(root, '.env', content), /already exists/)
    assert.equal(await readFile(resolve(root, '.env'), 'utf8'), 'SERVICE_API_KEY=private-fixture-secret')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('empty .env is a valid scaffold but an empty PDF is not a document', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-env-template-'))
  try {
    await createWorkspaceEnvTemplate(root, '.env', '')
    assert.equal((await verifyWorkspaceArtifacts(root, new Set(['.env']), '创建空白 .env')).verifiedFiles, 1)
    await createWorkspaceEnvTemplate(root, '.env.pdf', '')
    await assert.rejects(verifyWorkspaceArtifacts(root, new Set(['.env.pdf']), '生成 PDF'), /非空/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('template creation rejects values, shell expressions, traversal and symlinks', async () => {
  for (const code of ['TOKEN=secret', 'TOKEN=$(id)', 'source other.env', 'export TOKEN=secret', 'TOKEN="not empty"']) {
    assert.throws(() => assertEmptyEnvTemplate(code), /empty variable/)
  }
  assert.doesNotThrow(() => assertEmptyEnvTemplate("# local setup\nexport TOKEN=\nURL=''\nLOGIN=\"\" # blank\n"))
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-env-template-'))
  const outside = await mkdtemp(resolve(tmpdir(), 'gllm-env-outside-'))
  try {
    await symlink(outside, resolve(root, 'outside'))
    await assert.rejects(createWorkspaceEnvTemplate(root, 'outside/.env', ''), /outside/)
    await assert.rejects(createWorkspaceEnvTemplate(root, '../.env', ''), /outside/)
    await writeFile(resolve(outside, '.env'), 'preserve-fixture')
    await symlink(resolve(outside, '.env'), resolve(root, '.env'))
    await assert.rejects(createWorkspaceEnvTemplate(root, '.env', ''), /Symbolic/)
    await assert.rejects(inspectWorkspaceEnvFile(root, '.env'), /Symbolic/)
    assert.equal(await readFile(resolve(outside, '.env'), 'utf8'), 'preserve-fixture')
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})

test('concurrent template creation never overwrites the winner', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-env-template-'))
  try {
    const results = await Promise.allSettled([
      createWorkspaceEnvTemplate(root, '.env', 'FIRST=\n'),
      createWorkspaceEnvTemplate(root, '.env', 'SECOND=\n')
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.ok(['FIRST=\n', 'SECOND=\n'].includes(await readFile(resolve(root, '.env'), 'utf8')))
  } finally { await rm(root, { recursive: true, force: true }) }
})
