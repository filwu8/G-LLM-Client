/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'

// Test discovery is an explicit list in package.json, not a glob. That makes it
// very easy to write a test file that never runs: the file is green when you
// open it by hand, CI never touches it, and nobody notices -- two test files had
// been sitting unregistered for weeks, covering Windows file-lock retries and
// checkpoint round-trips, before this check existed. The suite looked larger
// than it was.
//
// The failure mode is silent by nature, so it needs a mechanical guard rather
// than a review habit.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const sourceRoot = join(repoRoot, 'src')

async function collectTestFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { found.push(...await collectTestFiles(full)); continue }
    if (entry.name.endsWith('.test.ts')) found.push(relative(repoRoot, full).split(sep).join('/'))
  }
  return found
}

const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
// Every script named test or test:* is treated as a discovery path; a file only
// has to appear in one of them to be run by some CI job.
const registered = new Set<string>()
for (const [name, command] of Object.entries(pkg.scripts)) {
  if (name !== 'test' && !name.startsWith('test:')) continue
  for (const match of command.matchAll(/(src\/[^\s'"]+\.test\.ts)/g)) registered.add(match[1])
}
const onDisk = await collectTestFiles(sourceRoot)

test('every test file is registered in a test script', () => {
  const unregistered = onDisk.filter(file => !registered.has(file)).sort()
  assert.deepEqual(
    unregistered, [],
    'These test files exist but no test script lists them, so CI never runs them. Add each one ' +
    'to the "test" script in package.json (or to a focused test:* script) so its assertions ' +
    'actually gate a merge. A test that cannot fail is not a test.'
  )
})

test('every registered test file exists', () => {
  // The mirror case: a rename or delete leaves the list pointing at nothing, and
  // node --test fails the whole run with a confusing module-not-found instead of
  // pointing at the stale entry.
  const missing = [...registered].filter(file => !onDisk.includes(file)).sort()
  assert.deepEqual(
    missing, [],
    'package.json lists these test files but they do not exist. Remove the stale entries or ' +
    'restore the files.'
  )
})

test('the guard itself is registered', () => {
  // Otherwise deleting this one line from package.json disables every check
  // here without any signal.
  assert.ok(
    registered.has('src/main/testSuiteIntegrity.test.ts'),
    'this guard must be listed in a test script, or it silently stops protecting anything'
  )
})
