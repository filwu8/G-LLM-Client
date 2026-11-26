/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Fail when a runtime dependency is missing from the shipped notice inventory.
//
// This replaces the previous CI gate, which regenerated the inventory and then ran
// `git diff --exit-code`. That gate could not work: generation calls
// `pnpm licenses list`, which resolves each package through a metadata file under
// <store>/v10/index, and a normal `pnpm install` never writes those files -- a
// store built from scratch by the install that preceded the build contained zero
// index files. The command only succeeds on a machine that still carries the
// leftovers of an older pnpm. So the inventory was regenerated on developer
// machines and checked here, without pretending CI can rebuild it.
//
// What this verifies:
//   - every runtime dependency declared by package.json appears in the inventory;
//   - every package the inventory lists still exists in the lockfile, so a renamed
//     or dropped dependency cannot linger in the shipped notices.
//
// What it cannot verify: that transitive dependencies are complete. That needs the
// real resolver, so `pnpm notices` stays a release-time step (see
// docs/release-qa-checklist.md).

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(resolve(projectRoot, name), 'utf8')

const manifest = JSON.parse(read('package.json'))
const notices = read('THIRD_PARTY_NOTICES.md')
const lockfile = read('pnpm-lock.yaml')

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Inventory rows look like `| name@version | license | link |`. */
function inventoryHas(name) {
  return new RegExp(`^\\| ${escapeRegExp(name)}@[^|]+\\|`, 'm').test(notices)
}

/** Lockfile package keys are `name@version` or `name@version(peer…)`, quoted. */
function lockfileHas(name) {
  return new RegExp(`^  '?${escapeRegExp(name)}@`, 'm').test(lockfile)
}

const failures = []

const runtime = new Set([
  ...Object.keys(manifest.dependencies || {}),
  ...Object.keys(manifest.optionalDependencies || {})
])

for (const name of [...runtime].sort()) {
  if (!inventoryHas(name)) {
    failures.push(`missing from THIRD_PARTY_NOTICES.md: ${name} (declared in package.json)`)
  }
}

for (const match of notices.matchAll(/^\| (@?[^@|\s]+)@([^|\s]+) \|/gm)) {
  const name = match[1]
  if (!lockfileHas(name)) {
    failures.push(`stale entry in THIRD_PARTY_NOTICES.md: ${name}@${match[2]} is not in pnpm-lock.yaml`)
  }
}

if (failures.length > 0) {
  console.error(`Notice inventory is out of sync (${failures.length} problem${failures.length === 1 ? '' : 's'}):`)
  for (const failure of failures.slice(0, 40)) console.error(`  - ${failure}`)
  if (failures.length > 40) console.error(`  ... and ${failures.length - 40} more`)
  console.error('\nRun `pnpm notices` on a development machine, review the diff and commit it.')
  process.exit(1)
}

console.log(
  `Notice inventory covers ${runtime.size} runtime dependencies; ` +
    `${[...notices.matchAll(/^\| @?[^@|\s]+@[^|\s]+ \|/gm)].length} entries all resolve in the lockfile.`
)
