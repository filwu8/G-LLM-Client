/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 *
 * Prepares resources/harness-runtime: a self-contained Node >= 24.9 runtime
 * plus the DeepSeek Harness package tree used by resources/harness-bridge.mjs.
 *
 * Run: node scripts/prepare-harness-runtime.mjs [--force]
 *
 * Why a script rather than checked-in node_modules:
 *  - the tree is ~600 MB and must not live in git
 *  - dsh@0.2.2-rc.1 under-declares several peer deps, so a plain `npm install`
 *    produces a tree that fails at runtime; this script closes that gap
 *    deterministically and verifies the result with a real SDK handshake.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const TARGET = join(PROJECT, 'resources', 'harness-runtime')
const NODE_VERSION = process.env.DSH_NODE_VERSION || '24.22.3'
const DSH_VERSION = process.env.DSH_VERSION || '0.2.2-rc.1'
const FORCE = process.argv.includes('--force')

// Packages that dsh@0.2.2-rc.1 imports but fails to declare as dependencies.
// Kept explicit so the prepared tree is reproducible.
const EXTRA_PEERS = [
  '@deepseek-ai/dsh-sdk-protocol',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-sdk-client',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-anonymous-user-id',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-shell',
  '@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-session-persistence'
]

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: TARGET, stdio: 'inherit', shell: process.platform === 'win32', ...opts
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`)
}

function nodeExe() {
  const name = process.platform === 'win32' ? 'node.exe' : 'node'
  return join(TARGET, 'node_modules', 'node', 'bin', name)
}

function main() {
  mkdirSync(TARGET, { recursive: true })
  const manifestPath = join(TARGET, 'package.json')
  const markerPath = join(TARGET, '.prepare-complete')
  if (!FORCE && existsSync(markerPath)) {
    console.log('Harness runtime already prepared. Use --force to rebuild.')
    return
  }

  const manifest = {
    name: 'gllm-harness-runtime',
    private: true,
    engines: { node: '>=24.9.0' },
    dependencies: {
      node: NODE_VERSION,
      '@deepseek-ai/dsh': DSH_VERSION,
      '@deepseek-ai/dsh-sdk-client': DSH_VERSION
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

  console.log('[1/4] Installing Node', NODE_VERSION, 'and dsh', DSH_VERSION, '(this can take several minutes)…')
  run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund'])

  console.log('[2/4] Closing dsh peer-dependency gaps…')
  for (const pkg of EXTRA_PEERS) {
    const version = pkg === '@deepseek-ai/dsh-invariants' ? '0.0.1-rc.5'
      : pkg === '@deepseek-ai/cordis' ? '4.1.0'
        : DSH_VERSION
    run('npm', ['install', `${pkg}@${version}`, '--legacy-peer-deps', '--no-audit', '--no-fund'])
  }

  console.log('[3/4] Verifying runtime handshake…')
  const probe = join(TARGET, '.handshake-probe.mjs')
  writeFileSync(probe, [
    "import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'",
    "import { mkdtempSync } from 'node:fs'",
    "import { tmpdir } from 'node:os'",
    "import { join } from 'node:path'",
    `const cwd = mkdtempSync(join(tmpdir(), 'gllm-hc-'))`,
    `const home = mkdtempSync(join(tmpdir(), 'gllm-hh-'))`,
    'const client = new HarnessClient({ profile: \'sdk-minimal\', cwd, processCwd: cwd, dshHome: home,',
    '  initializeTimeoutMs: 60000, env: { ...process.env, DEEPSEEK_API_KEY: \'sk-prepare-probe\' } })',
    'client.start()',
    "const r = await client.initialize({ cwd, provider: 'deepseek-official', model: 'deepseek-chat' })",
    "if (!r?.serverInfo?.name) throw new Error('Bad handshake')",
    'await client.close()',
    "console.log('handshake ok:', r.serverInfo.name)"
  ].join('\n') + '\n')
  try {
    run(nodeExe(), [probe])
  } finally {
    try { writeFileSync(markerPath, new Date().toISOString()) } catch {}
  }

  console.log('[4/4] Runtime ready at', TARGET)
}

try { main() } catch (error) {
  console.error('Failed to prepare Harness runtime:', error.message)
  process.exit(1)
}
