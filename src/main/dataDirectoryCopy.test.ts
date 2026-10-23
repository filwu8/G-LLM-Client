/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyPersistentData } from './dataDirectoryCopy.ts'

test('data migration excludes live Chromium locks and retains conversations and generated files', t => {
  const root = mkdtempSync(join(tmpdir(), 'gllm-data-copy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target')
  mkdirSync(join(source, 'generated-images'), { recursive: true })
  writeFileSync(join(source, 'g-llm-client.json'), '{"conversations":[1]}')
  writeFileSync(join(source, 'generated-images', 'image.png'), 'image')
  for (const name of ['SingletonCookie', 'SingletonLock', 'SingletonSocket', 'DevToolsActivePort', 'lockfile']) writeFileSync(join(source, name), 'runtime')
  copyPersistentData(source, target)
  assert.equal(readFileSync(join(target, 'g-llm-client.json'), 'utf8'), '{"conversations":[1]}')
  assert.equal(readFileSync(join(target, 'generated-images', 'image.png'), 'utf8'), 'image')
  assert.equal(existsSync(join(target, 'SingletonCookie')), false)
  assert.equal(existsSync(join(target, 'lockfile')), false)
  assert.equal(readFileSync(join(source, 'SingletonCookie'), 'utf8'), 'runtime')
})

test('migration skips dangling Cookie and nested links without following them outside the directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'gllm-data-link-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target')
  mkdirSync(source)
  writeFileSync(join(source, 'settings.json'), 'settings')
  try {
    symlinkSync(join(root, 'missing-cookie'), join(source, 'SingletonCookie'))
    symlinkSync(join(root, 'missing-file'), join(source, 'dangling'))
    symlinkSync(root, join(source, 'cycle'), 'junction')
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { t.skip('Windows symbolic link privilege unavailable'); return }
    throw error
  }
  copyPersistentData(source, target)
  assert.equal(lstatSync(join(source, 'SingletonCookie')).isSymbolicLink(), true)
  assert.equal(existsSync(join(target, 'dangling')), false)
  assert.equal(existsSync(join(target, 'cycle')), false)
  assert.equal(readFileSync(join(target, 'settings.json'), 'utf8'), 'settings')
})

test('migration does not write through an existing destination link', t => {
  const root = mkdtempSync(join(tmpdir(), 'gllm-data-destination-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target'), outside = join(root, 'outside')
  mkdirSync(source); mkdirSync(target); mkdirSync(outside)
  mkdirSync(join(source, 'images'))
  writeFileSync(join(source, 'images', 'new.png'), 'new')
  symlinkSync(outside, join(target, 'images'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => copyPersistentData(source, target), /symbolic link/)
  assert.equal(existsSync(join(outside, 'new.png')), false)
})
