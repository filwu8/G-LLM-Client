/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const fixture = await mkdtemp(join(tmpdir(), 'gllm-storage-migration-'))
const output = resolve('.cache', `storage-migration-${Date.now()}`)
try {
  await mkdir(output, { recursive: true })
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const external = ['electron', ...Object.keys(pkg.dependencies)]
  await build({ configFile: false, logLevel: 'error', build: { ssr: resolve('src/main/storageMigration.integration.ts'), outDir: output, emptyOutDir: false, rollupOptions: { external: id => id.startsWith('node:') || external.some(name => id === name || id.startsWith(`${name}/`)), output: { format: 'es', entryFileNames: 'index.mjs' } } } })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  process.exitCode = await new Promise((resolvePromise, reject) => {
    const child = spawn(require('electron'), [join(output, 'index.mjs'), fixture], { env, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', code => resolvePromise(code ?? 1))
  })
} finally {
  await rm(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
