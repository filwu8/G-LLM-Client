/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { redactGitOutput, runGitRead, runGitWrite, planProjectCheck, discoverWorkspaceRepositories } from './workspaceGit.ts'

test('git output redacts URL credentials and secret assignments', () => {
  assert.match(redactGitOutput('origin https://user:token123@github.com/a/b.git (fetch)'), /\[REDACTED\]@github\.com/)
  assert.doesNotMatch(redactGitOutput('origin https://user:token123@github.com/a/b.git'), /token123/)
  assert.equal(redactGitOutput('password=supersecret\napi_key: abc123'), 'password=[REDACTED]\napi_key=[REDACTED]')
  assert.equal(redactGitOutput('token = spaced'), 'token=[REDACTED]')
})

test('git_read rejects invalid operations, refs and protected or escaping paths', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-git-read-test-'))
  try {
    await assert.rejects(runGitRead(root, { operation: 'push' }), /不支持的 git 操作/)
    await assert.rejects(runGitRead(root, { operation: 'show', ref: '--exec=calc' }), /无效的 Git 引用/)
    await assert.rejects(runGitRead(root, { operation: 'status', path: '.git/config' }), /受保护/)
    await assert.rejects(runGitRead(root, { operation: 'status', path: '../outside' }), /超出/)
    await assert.rejects(runGitRead(root, { operation: 'status', path: '/absolute' }), /相对路径/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('git_read reports a clean failure for a directory that is not a repository', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-git-norepo-test-'))
  try {
    const result = await runGitRead(root, { operation: 'status' })
    assert.match(result.output, /Exit code: [^0]/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('git_write rejects unsupported operations and unsafe parameters', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-git-write-test-'))
  try {
    await assert.rejects(runGitWrite(root, { operation: 'push' }), /不支持的 Git 写操作/)
    await assert.rejects(runGitWrite(root, { operation: 'fetch', remote: '--upload-pack=calc' }), /无效的 Git remote/)
    await assert.rejects(runGitWrite(root, { operation: 'reset' }), /需要提供 ref/)
    await assert.rejects(runGitWrite(root, { operation: 'reset', ref: '--exec=calc' }), /无效的 Git 引用/)
    await assert.rejects(runGitWrite(root, { operation: 'reset', ref: 'HEAD', path: '../outside' }), /超出/)
    await assert.rejects(runGitWrite(root, { operation: 'clean' }), /force=true/)
    await assert.rejects(runGitWrite(root, { operation: 'clean', force: true }), /相对路径/)
    await assert.rejects(runGitWrite(root, { operation: 'pull', rebase: 'maybe' }), /无效的布尔参数/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('git_write runs an allowlisted reset against a real repository and reports exit code', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-git-write-repo-'))
  try {
    const { execFileSync } = await import('node:child_process')
    const git = (...argv: string[]) => execFileSync('git', argv, { cwd: root, encoding: 'utf8', stdio: 'pipe' })
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    await writeFile(resolve(root, 'tracked.txt'), 'v1\n')
    git('add', 'tracked.txt')
    git('commit', '-qm', 'initial')
    await writeFile(resolve(root, 'tracked.txt'), 'modified\n')
    const before = await runGitRead(root, { operation: 'status' })
    assert.match(before.output, /tracked\.txt/)
    const result = await runGitWrite(root, { operation: 'reset', ref: 'HEAD', mode: 'hard' })
    assert.equal(result.exitCode, 0)
    assert.match(result.output, /Exit code: 0/)
    assert.match(result.output, /git reset --hard HEAD/)
    const after = await runGitRead(root, { operation: 'status' })
    assert.match(after.output, /##/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('git tools run inside a selected repo in a multi-repository workspace', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-git-multirepo-test-'))
  try {
    const { execFileSync } = await import('node:child_process')
    const git = (cwd: string, ...argv: string[]) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: 'pipe' })
    // Outer repo, plus an independent nested clone with a distinct commit.
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'test@example.com')
    git(root, 'config', 'user.name', 'Test')
    await writeFile(resolve(root, 'root-only.txt'), 'root\n')
    git(root, 'add', 'root-only.txt')
    git(root, 'commit', '-qm', 'root commit')
    const nested = resolve(root, 'nested')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(nested, { recursive: true })
    git(nested, 'init', '-q')
    git(nested, 'config', 'user.email', 'test@example.com')
    git(nested, 'config', 'user.name', 'Test')
    await writeFile(resolve(nested, 'nested-only.txt'), 'nested\n')
    git(nested, 'add', 'nested-only.txt')
    git(nested, 'commit', '-qm', 'nested commit')

    const rootLog = await runGitRead(root, { operation: 'log', limit: 5 })
    assert.match(rootLog.output, /root commit/)
    assert.doesNotMatch(rootLog.output, /nested commit/)
    const nestedLog = await runGitRead(root, { operation: 'log', limit: 5, repo: 'nested' })
    assert.match(nestedLog.output, /repo: nested/)
    assert.match(nestedLog.output, /nested commit/)
    assert.doesNotMatch(nestedLog.output, /root commit/)

    // reset against the nested repo only touches that repository.
    await writeFile(resolve(nested, 'nested-only.txt'), 'dirty\n')
    const write = await runGitWrite(root, { operation: 'reset', ref: 'HEAD', mode: 'hard', repo: 'nested' })
    assert.equal(write.exitCode, 0)
    assert.match(write.output, /repo: nested/)
    const { readFile } = await import('node:fs/promises')
    assert.equal((await readFile(resolve(nested, 'nested-only.txt'), 'utf8')).trim(), 'nested')

    await assert.rejects(runGitRead(root, { operation: 'status', repo: 'missing-repo' }), /repo 目录不存在/)
    await assert.rejects(runGitRead(root, { operation: 'status', repo: '../outside' }), /超出/)
    await assert.rejects(runGitRead(root, { operation: 'status', repo: '.git' }), /受保护/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('discoverWorkspaceRepositories finds root and nested repos but skips .git internals', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-git-discover-test-'))
  try {
    const { execFileSync } = await import('node:child_process')
    const { mkdir } = await import('node:fs/promises')
    const git = (cwd: string, ...argv: string[]) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: 'pipe' })
    git(root, 'init', '-q', '-b', 'main')
    const nested = resolve(root, 'erpv3main')
    await mkdir(nested, { recursive: true })
    git(nested, 'init', '-q', '-b', 'dev')
    const repos = await discoverWorkspaceRepositories(root)
    assert.deepEqual(repos.map((r) => r.path).sort(), ['.', 'erpv3main'].sort())
    assert.equal(repos.find((r) => r.path === '.')?.branch, 'main')
    assert.equal(repos.find((r) => r.path === 'erpv3main')?.branch, 'dev')
    // .git internals and node_modules must never be reported as repositories.
    assert.equal(repos.some((r) => r.path.includes('.git') || r.path.includes('node_modules')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('planProjectCheck only accepts known categories and derives an allowlisted command', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-project-check-test-'))
  try {
    await assert.rejects(planProjectCheck(root, 'deploy'), /不支持的检查类型/)
    await assert.rejects(planProjectCheck(root, 'test'), /没有可用的/)
    await writeFile(resolve(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', build: 'tsc' } }))
    await assert.rejects(planProjectCheck(root, 'lint'), /没有可用的/)
    const npm = await planProjectCheck(root, 'test')
    assert.equal(npm.code, 'npm run test')
    await writeFile(resolve(root, 'pnpm-lock.yaml'), '')
    const pnpm = await planProjectCheck(root, 'build')
    assert.equal(pnpm.code, 'pnpm build')
  } finally { await rm(root, { recursive: true, force: true }) }
})
