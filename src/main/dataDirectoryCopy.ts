/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { closeSync, copyFileSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'

// Chromium's process locks can be dangling symlinks (especially on macOS).
// They belong to the running browser, never to a portable data directory.
export function isTransientDataEntry(path: string): boolean {
  return /^(?:Singleton.*|DevToolsActivePort|lockfile|\.org\.chromium\..*)$/i.test(basename(path))
}

function digestFile(path: string): string {
  const file = openSync(path, 'r')
  try {
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024)
    let bytes: number
    while ((bytes = readSync(file, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes))
    return `${fstatSync(file).size}:${hash.digest('hex')}`
  } finally { closeSync(file) }
}

export function copyPersistentData(source: string, target: string, verify = false): void {
  if (isTransientDataEntry(source)) return
  const info = lstatSync(source)
  if (info.isSymbolicLink()) return
  // Never follow a pre-existing destination link outside the selected directory.
  const destination = lstatSync(target, { throwIfNoEntry: false })
  if (destination?.isSymbolicLink()) throw new Error(`Data destination is a symbolic link: ${target}`)
  if (info.isDirectory()) {
    mkdirSync(target, { recursive: true })
    for (const name of readdirSync(source)) copyPersistentData(join(source, name), join(target, name), verify)
  } else if (info.isFile()) {
    copyFileSync(source, target)
    if (verify && digestFile(source) !== digestFile(target)) throw new Error(`Copied data did not pass verification: ${source}`)
  }
}
