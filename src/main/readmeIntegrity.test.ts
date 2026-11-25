/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// The README set drifted for many releases without anyone noticing: the Chinese
// and English files followed the version bump, the other eleven stayed at
// V2.0.23 for months, and none of them mentioned the Store at all even though
// it had become the main distribution channel. Nothing was broken, so nothing
// reported it. A hand-maintained list of thirteen files in thirteen languages
// will drift again, so the invariant is checked mechanically instead of by
// memory.
//
// The checks are language-independent on purpose. Matching localized labels
// ("当前代码版本", "Aktuelle Codeversion", ...) would need editing every time a
// language is added, and the label is not the contract. The contract is that
// whichever line points at a release note must point at the current one.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const storeUrl = 'https://apps.microsoft.com/detail/9MVD547V4ZN9'

const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
const readmeNames = (await readdir(repoRoot)).filter(name => /^README(\.[\w-]+)?\.md$/.test(name)).sort()

async function read(name: string): Promise<string> {
  return await readFile(join(repoRoot, name), 'utf8')
}

test('the README set is found at all', () => {
  // Without this, a rename that hides every README would make the checks below
  // pass over an empty list.
  assert.ok(readmeNames.length >= 2, `expected several README files, found ${readmeNames.length}`)
  assert.ok(readmeNames.includes('README.md'), 'README.md must exist as the entry point')
})

test('every README points its version line at the current release note', async () => {
  const expectedDoc = `docs/releases/v${pkg.version}.md`
  const offenders: string[] = []

  for (const name of readmeNames) {
    const lines = (await read(name)).split(/\r?\n/)
    const versionLine = lines.find(line => /docs\/releases\/v\d+\.\d+\.\d+\.md/.test(line))
    if (!versionLine) {
      offenders.push(`${name}: no line links to a release note; expected a link to ${expectedDoc}`)
      continue
    }
    if (!versionLine.includes(expectedDoc)) {
      const found = versionLine.match(/docs\/releases\/(v\d+\.\d+\.\d+\.md)/)?.[1] ?? 'nothing'
      offenders.push(`${name}: links to ${found}, package.json says ${pkg.version}`)
      continue
    }
    if (!versionLine.includes(`V${pkg.version}`)) {
      offenders.push(`${name}: the link targets ${pkg.version} but the visible text disagrees`)
    }
  }

  assert.deepEqual(offenders, [], 'Each README must advertise the version in package.json. Update them together.')
})

test('every release note a README points at exists', async () => {
  const missing: string[] = []
  for (const name of readmeNames) {
    const lines = (await read(name)).split(/\r?\n/)
    const versionLine = lines.find(line => /docs\/releases\/v\d+\.\d+\.\d+\.md/.test(line)) ?? ''
    for (const match of versionLine.matchAll(/docs\/releases\/v\d+\.\d+\.\d+\.md/g)) {
      if (!existsSync(join(repoRoot, match[0]))) missing.push(`${name} -> ${match[0]}`)
    }
  }
  assert.deepEqual(missing, [], 'A README links to a release note that does not exist on disk.')
})

test('every README links to the Store listing', async () => {
  // Adding a language by copying an old file would otherwise reintroduce the
  // state this test was written to end: a README that never mentions where the
  // product is actually downloaded from.
  const offenders: string[] = []
  for (const name of readmeNames) {
    if (!(await read(name)).includes(storeUrl)) offenders.push(name)
  }
  assert.deepEqual(offenders, [], `These README files do not link to ${storeUrl}.`)
})

test('every README lists every README in its language switcher', async () => {
  // The switcher is the navigation; a language missing from it is effectively
  // unreachable, and a stale entry sends readers to a 404.
  const problems: string[] = []
  for (const name of readmeNames) {
    const text = await read(name)
    const listed = new Set(
      [...text.matchAll(/\(\.\/(README(?:\.[\w-]+)?\.md)\)/g)].map(match => match[1])
    )
    const absent = readmeNames.filter(other => !listed.has(other))
    if (absent.length) problems.push(`${name}: switcher omits ${absent.join(', ')}`)
    const stale = [...listed].filter(target => !readmeNames.includes(target))
    if (stale.length) problems.push(`${name}: switcher points at missing ${stale.join(', ')}`)
  }
  assert.deepEqual(problems, [], 'The language switcher must match the README files on disk.')
})
