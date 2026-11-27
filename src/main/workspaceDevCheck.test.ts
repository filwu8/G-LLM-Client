/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { availableProjectChecks } from './workspaceGit.ts'
import {
  changedCodeFiles,
  describeCheckFailure,
  devCheckActivityLabel,
  devCheckFeedback,
  devCheckRequestMessage,
  devCheckSummary,
  isCodeFile,
  looksLikeMissingToolchain,
  pendingDevChecks,
  requiredDevChecks
} from './workspaceDevCheck.ts'

test('counts source files as code and generated output as not', () => {
  assert.equal(isCodeFile('src/main/workspaceAgent.ts'), true)
  assert.equal(isCodeFile('src\\renderer\\App.tsx'), true)
  assert.equal(isCodeFile('./scripts/build.mjs'), true)
  assert.equal(isCodeFile('README.md'), false)
  assert.equal(isCodeFile('data/report.csv'), false)
  assert.equal(isCodeFile('node_modules/left-pad/index.js'), false)
  assert.equal(isCodeFile('out/renderer/assets/index.js'), false)
  assert.equal(isCodeFile('.gitignore'), false)
  assert.deepEqual(changedCodeFiles(['node_modules/x/y.js', 'src/a.ts', 'src/a.ts', 'docs/readme.md']), ['src/a.ts'])
})

test('requires a typecheck whenever the project has one, and tests only when in scope', () => {
  const base = { available: ['typecheck', 'test'], passed: new Map<string, number>(), codeVersion: 3, latestUserRequest: '把标题改成大写' }
  assert.deepEqual(requiredDevChecks({ ...base, changedFiles: ['src/title.ts'] }), ['typecheck'])
  assert.deepEqual(requiredDevChecks({ ...base, changedFiles: ['src/title.test.ts'] }), ['typecheck', 'test'])
  assert.deepEqual(requiredDevChecks({ ...base, changedFiles: ['src/title.ts'], latestUserRequest: '改完跑一下测试' }), ['typecheck', 'test'])
  assert.deepEqual(requiredDevChecks({ ...base, changedFiles: ['README.md'] }), [], 'a docs-only change needs no check')
  assert.deepEqual(
    requiredDevChecks({ ...base, available: ['lint'], changedFiles: ['src/title.ts'] }),
    [],
    'a project with only lint has nothing the client may gate on'
  )
})

test('a check that passed before the last edit does not count as verified', () => {
  const state = {
    changedFiles: ['src/a.ts'],
    available: ['typecheck'],
    passed: new Map([['typecheck', 2]]),
    codeVersion: 2
  }
  assert.deepEqual(pendingDevChecks(state), [])
  assert.deepEqual(pendingDevChecks({ ...state, codeVersion: 3 }), ['typecheck'])
})

test('summarises the failing lines instead of the whole log', () => {
  const log = [
    'Exit code: 2',
    '> tsc --noEmit',
    '',
    'src/a.ts(12,7): error TS2322: Type "string" is not assignable to type "number".',
    'src/b.ts(3,1): error TS2304: Cannot find name "foo".',
    '',
    'Found 2 errors in 2 files.'
  ].join('\n')
  const summary = describeCheckFailure(log)
  assert.match(summary, /error TS2322/)
  assert.match(summary, /error TS2304/)
  assert.doesNotMatch(summary, /Exit code/)
  assert.ok(summary.length < log.length + 40)
})

test('falls back to the tail when nothing looks like an error', () => {
  const summary = describeCheckFailure('line one\nline two\nnot ok 3 - adds two numbers')
  assert.match(summary, /not ok 3/)
})

test('caps a huge log and says how much was dropped', () => {
  const log = Array.from({ length: 200 }, (_, index) => `error TS1${index}: boom`).join('\n')
  const summary = describeCheckFailure(log)
  assert.equal(summary.split('\n').length, 15)
  assert.match(summary, /未显示/)
})

test('feedback names the command, the exit code and the rules that matter', () => {
  const message = devCheckFeedback({
    language: 'zh',
    attempt: 1,
    limit: 2,
    results: [{ category: 'typecheck', label: 'pnpm typecheck (typecheck)', exitCode: 2, output: 'Exit code: 2\nsrc/a.ts(1,1): error TS1005: expected ;' }]
  })
  assert.match(message, /^\[客户端自动验证\]/)
  assert.match(message, /pnpm typecheck/)
  assert.match(message, /退出码：2/)
  assert.match(message, /error TS1005/)
  assert.match(message, /不要删除、跳过或改写失败的测试/)
  assert.match(message, /第 1\/2 次/)
})

test('feedback in English keeps the same guarantees', () => {
  const message = devCheckFeedback({
    language: 'en',
    attempt: 2,
    limit: 2,
    results: [{ category: 'test', label: 'npm run test', exitCode: 1, output: 'not ok 1 - parser' }]
  })
  assert.match(message, /^\[Client verification\]/)
  assert.match(message, /attempt 2\/2/)
  assert.match(message, /Do not delete, skip or rewrite a failing test/)
  assert.match(message, /not ok 1 - parser/)
})

test('the request form points at the exact tool call instead of running it silently', () => {
  const message = devCheckRequestMessage({
    language: 'zh',
    pending: ['typecheck', 'test'],
    labels: new Map([['typecheck', 'pnpm typecheck (typecheck)'], ['test', 'pnpm test (test)']]),
    attempt: 1,
    limit: 2
  })
  assert.match(message, /run_project_check\(check: "typecheck"\)/)
  assert.match(message, /run_project_check\(check: "test"\)/)
  assert.match(message, /pnpm test \(test\)/)
})

test('verification evidence lists only the checks that actually passed', () => {
  assert.equal(devCheckSummary('zh', [{ category: 'typecheck', label: 'pnpm typecheck', exitCode: 0, output: '' }]), '客户端复跑通过：pnpm typecheck')
  assert.equal(devCheckSummary('zh', [{ category: 'typecheck', label: 'pnpm typecheck', exitCode: 2, output: '' }]), '')
  assert.equal(devCheckActivityLabel('en', 'test'), 'Auto-verify test')
})

test('tells a missing runner apart from a red build', () => {
  assert.equal(looksLikeMissingToolchain("'pnpm' is not recognized as an internal or external command,\r\noperable program or batch file."), true)
  assert.equal(looksLikeMissingToolchain('/bin/sh: 1: pnpm: not found'), true)
  assert.equal(looksLikeMissingToolchain('Error: Cannot find module "typescript"'), true)
  assert.equal(looksLikeMissingToolchain('src/a.ts(1,1): error TS1005: expected ;'), false)
  assert.equal(looksLikeMissingToolchain('src/b.ts(2,3): error TS2304: Cannot find name "foo".'), false)
})

test('reads which checks a project can answer without throwing on a missing manifest', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'gllm-dev-check-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(await availableProjectChecks(root), [])
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', 'type-check': 'tsc --noEmit', lint: 'eslint .' } }))
  assert.deepEqual(await availableProjectChecks(root), ['test', 'typecheck', 'lint'])
})
