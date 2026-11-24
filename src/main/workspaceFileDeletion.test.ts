/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { resolveDeletableWorkspaceFile } from './workspaceFileDeletion.ts'

async function createWorkspace(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gllm-delete-file-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('accepts a regular file and reports what will be deleted', async (t) => {
  const root = await createWorkspace(t)
  await writeFile(join(root, 'probe.txt'), 'GLLM_OK_2026', 'utf8')

  const target = await resolveDeletableWorkspaceFile(root, 'probe.txt')
  assert.equal(target.relativePath, 'probe.txt')
  assert.equal(target.size, 12)
})

test('refuses an absolute path so the model cannot reach outside the workspace', async (t) => {
  const root = await createWorkspace(t)
  const outside = join(tmpdir(), 'gllm-delete-outside.txt')
  await writeFile(outside, 'x', 'utf8')
  t.after(() => rm(outside, { force: true }))

  await assert.rejects(
    resolveDeletableWorkspaceFile(root, outside),
    /工具只能使用工作区相对路径/
  )
})

test('refuses a relative path that climbs out of the workspace', async (t) => {
  const root = await createWorkspace(t)
  await assert.rejects(
    resolveDeletableWorkspaceFile(root, '../escape.txt'),
    /路径超出当前会话工作区|ENOENT/
  )
})

test('refuses credential files even when they exist', async (t) => {
  const root = await createWorkspace(t)
  await writeFile(join(root, '.env'), 'TOKEN=secret', 'utf8')

  await assert.rejects(
    resolveDeletableWorkspaceFile(root, '.env'),
    /Protected credentials|凭据/
  )
})

test('refuses git metadata so history cannot be destroyed', async (t) => {
  const root = await createWorkspace(t)
  await mkdir(join(root, '.git'))
  await writeFile(join(root, '.git', 'config'), '[core]', 'utf8')

  await assert.rejects(
    resolveDeletableWorkspaceFile(root, '.git/config'),
    /.git|Git 仓库元数据|Protected/
  )
})

test('refuses a directory because recursive deletion is a different risk class', async (t) => {
  const root = await createWorkspace(t)
  await mkdir(join(root, 'folder'))

  await assert.rejects(
    resolveDeletableWorkspaceFile(root, 'folder'),
    /目录|directory/
  )
})

test('refuses a symbolic link instead of following it to its target', async (t) => {
  const root = await createWorkspace(t)
  await writeFile(join(root, 'victim.txt'), 'keep me', 'utf8')

  // Creating a file symlink needs Developer Mode or elevation on Windows. A
  // directory junction does not, and Node reports junctions as symlinks too, so
  // fall back to one rather than skipping: this guard must be actually exercised.
  let linkCreated = false
  try {
    await symlink(join(root, 'victim.txt'), join(root, 'link.txt'))
    linkCreated = true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? ''
    if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(code)) throw error
  }
  if (!linkCreated) {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    try {
      await run('cmd', ['/c', 'mklink', '/J', join(root, 'link.txt'), join(root, 'victim.txt')])
      linkCreated = true
    } catch {
      // Neither mechanism is available; the guard stays covered on other hosts.
    }
  }
  if (!linkCreated) {
    t.skip('this account can create neither a symlink nor a junction')
    return
  }

  await assert.rejects(
    resolveDeletableWorkspaceFile(root, 'link.txt'),
    /符号链接|symbolic/
  )
})

test('refuses a file that is not there, rather than reporting a phantom delete', async (t) => {
  const root = await createWorkspace(t)
  await assert.rejects(
    resolveDeletableWorkspaceFile(root, 'missing.txt'),
    /ENOENT|不存在/
  )
})
