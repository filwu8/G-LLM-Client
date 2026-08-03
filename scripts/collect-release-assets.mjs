/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const platform = process.argv[2]
const sourceDirectory = process.argv[3] ?? 'dist'
const outputDirectory = process.argv[4] ?? 'release-assets'

const policies = {
  windows: {
    metadata: 'latest.yml',
    requiredExtensions: ['.exe'],
    allowed: /^(?:G-LLM-Client.+\.(?:exe|exe\.blockmap)|latest\.yml)$/u
  },
  macos: {
    metadata: 'latest-mac.yml',
    requiredExtensions: ['.dmg', '.zip'],
    allowed: /^(?:G-LLM-Client.+\.(?:dmg|dmg\.blockmap|zip|zip\.blockmap)|latest-mac\.yml)$/u
  },
  linux: {
    metadata: 'latest-linux.yml',
    requiredExtensions: ['.AppImage', '.deb'],
    allowed: /^(?:G-LLM-Client.+\.(?:AppImage|AppImage\.blockmap|deb)|latest-linux\.yml)$/u
  }
}

const policy = policies[platform]
if (!policy) throw new Error(`Unsupported release platform: ${platform ?? '(missing)'}`)

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const version = String(packageJson.version ?? '').trim()
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error(`Invalid package version: ${version || '(missing)'}`)
}

const entries = await readdir(sourceDirectory)
const artifactPrefix = `G-LLM-Client-Setup-${version}-`
const selected = entries
  .filter((name) => name === policy.metadata || (name.startsWith(artifactPrefix) && policy.allowed.test(name)))
  .sort()
if (!selected.includes(policy.metadata)) throw new Error(`Missing update metadata: ${policy.metadata}`)
for (const extension of policy.requiredExtensions) {
  if (!selected.some((name) => name.endsWith(extension))) throw new Error(`Missing required ${platform} ${extension} artifact`)
}

const metadata = await readFile(join(sourceDirectory, policy.metadata), 'utf8')
if (!new RegExp(`^version:\\s*["']?${version.replace(/\./g, '\\.')}(?:["']?\\s*)$`, 'mu').test(metadata)) {
  throw new Error(`${policy.metadata} does not contain package version ${version}`)
}

await mkdir(outputDirectory, { recursive: true })
const checksums = []
for (const name of selected) {
  if (basename(name) !== name || !/^[0-9A-Za-z._+()-]+$/u.test(name)) throw new Error(`Unsafe artifact name: ${name}`)
  const sourcePath = join(sourceDirectory, name)
  const fileStat = await stat(sourcePath)
  if (!fileStat.isFile() || fileStat.size === 0) throw new Error(`Invalid release artifact: ${sourcePath}`)
  const content = await readFile(sourcePath)
  const digest = createHash('sha256').update(content).digest('hex')
  await copyFile(sourcePath, join(outputDirectory, name))
  checksums.push(`${digest}  ${name}`)
}

await writeFile(join(outputDirectory, `SHA256SUMS-${platform}.txt`), `${checksums.join('\n')}\n`, 'utf8')
console.log(`Collected ${selected.length} ${platform} release assets for V${version}.`)
