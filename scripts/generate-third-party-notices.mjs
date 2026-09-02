/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(projectRoot, 'THIRD_PARTY_NOTICES.md')
const projectPackage = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'))
const directOptionalDependencies = new Set(Object.keys(projectPackage.optionalDependencies || {}))

function isUnshippedCanvasNativePackage(name) {
  return /^@napi-rs\/canvas-(?:darwin|linux|win32)-/u.test(name) && !directOptionalDependencies.has(name)
}

const pnpmCommand = process.platform === 'win32'
  ? { executable: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm'] }
  : { executable: 'pnpm', args: [] }

const rawInventory = execFileSync(pnpmCommand.executable, [...pnpmCommand.args, 'licenses', 'list', '--prod', '--json'], {
  cwd: projectRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024
})

const groupedInventory = JSON.parse(rawInventory)
const packages = []

function projectUrl(packageJson, fallback = '') {
  const repository = typeof packageJson.repository === 'string'
    ? packageJson.repository
    : packageJson.repository?.url
  return String(packageJson.homepage || fallback || repository || '')
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
}

for (const [licenseGroup, entries] of Object.entries(groupedInventory)) {
  for (const entry of entries) {
    for (let index = 0; index < entry.paths.length; index += 1) {
      const packagePath = entry.paths[index]
      const packageJsonPath = resolve(packagePath, 'package.json')
      const packageJson = existsSync(packageJsonPath)
        ? JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        : {}
      const packageName = packageJson.name || entry.name

      // @napi-rs/canvas declares native packages for many operating systems,
      // architectures, and C libraries. Local installers may retain a different
      // subset on each host. Only the native targets explicitly shipped by this
      // project belong in the shared release notice.
      if (isUnshippedCanvasNativePackage(packageName)) continue

      packages.push({
        name: packageName,
        version: packageJson.version || entry.versions[index] || entry.versions[0] || 'unknown',
        declaredLicense: packageJson.license || entry.license || licenseGroup,
        homepage: projectUrl(packageJson, entry.homepage),
        packagePath
      })
    }
  }
}

// pnpm reports only the current operating system's optional packages. Include
// every installed direct optional dependency so notices remain complete for
// macOS, Linux, and Windows artifacts built from the same release source.
for (const name of directOptionalDependencies) {
  const packagePath = resolve(projectRoot, 'node_modules', ...name.split('/'))
  const packageJsonPath = resolve(packagePath, 'package.json')
  if (!existsSync(packageJsonPath)) continue
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  packages.push({
    name: packageJson.name || name,
    version: packageJson.version || projectPackage.optionalDependencies[name] || 'unknown',
    declaredLicense: packageJson.license || 'Unknown',
    homepage: projectUrl(packageJson),
    packagePath
  })
}

const uniquePackages = new Map()
for (const dependency of packages) {
  uniquePackages.set(`${dependency.name}@${dependency.version}`, dependency)
}

const dependencies = [...uniquePackages.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, 'en')
)

const noticePattern = /^(license|licence|copying|notice|copyright)([._-]|$)/i
const noticeGroups = new Map()
const missingNoticeFiles = []

function inferLicense(declaredLicense, contents) {
  if (declaredLicense && declaredLicense !== 'Unknown') return declaredLicense

  const combined = contents.join('\n')
  if (/Permission is hereby granted, free of charge/i.test(combined)) return 'MIT'
  if (/Apache License\s+Version 2\.0/i.test(combined)) return 'Apache-2.0'
  if (/Mozilla Public License\s+Version 2\.0/i.test(combined)) return 'MPL-2.0'
  return declaredLicense || 'Unknown'
}

for (const dependency of dependencies) {
  const noticeFiles = readdirSync(dependency.packagePath, { withFileTypes: true })
    .filter((item) => item.isFile() && noticePattern.test(item.name))
    .map((item) => item.name)
    .sort((left, right) => left.localeCompare(right, 'en'))

  const contents = noticeFiles
    .map((fileName) =>
      readFileSync(resolve(dependency.packagePath, fileName), 'utf8')
        .replaceAll('\r\n', '\n')
        .replaceAll('\r', '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim()
    )
    .filter(Boolean)

  dependency.license = inferLicense(dependency.declaredLicense, contents)

  if (contents.length === 0) {
    missingNoticeFiles.push(dependency)
    continue
  }

  for (const content of contents) {
    const digest = createHash('sha256').update(content).digest('hex')
    const group = noticeGroups.get(digest) || { content, packages: [] }
    group.packages.push(`${dependency.name}@${dependency.version}`)
    noticeGroups.set(digest, group)
  }
}

function escapeTableCell(value) {
  return String(value || '').replaceAll('|', '\\|').replaceAll('\n', ' ')
}

const lines = [
  '# Third-Party Notices',
  '',
  'G-LLM Desktop Client includes the third-party components listed below.',
  'Each component remains subject to its own license. The G-LLM source license',
  'does not replace, restrict, or expand those third-party license terms.',
  '',
  'This file is generated from the locked production dependency graph by',
  '`pnpm licenses:generate`. Do not edit it manually.',
  '',
  '## Component Inventory',
  '',
  '| Component | License | Project |',
  '| --- | --- | --- |'
]

for (const dependency of dependencies) {
  const project = dependency.homepage ? `[link](${dependency.homepage})` : ''
  lines.push(
    `| ${escapeTableCell(`${dependency.name}@${dependency.version}`)} | ${escapeTableCell(dependency.license)} | ${project} |`
  )
}

lines.push('', '## License and Notice Texts', '')

const sortedNoticeGroups = [...noticeGroups.values()].sort((left, right) =>
  left.packages[0].localeCompare(right.packages[0], 'en')
)

for (const group of sortedNoticeGroups) {
  group.packages.sort((left, right) => left.localeCompare(right, 'en'))
  lines.push(`### ${group.packages.join(', ')}`, '', '````text', group.content, '````', '')
}

if (missingNoticeFiles.length > 0) {
  lines.push(
    '## Components Without a Bundled Notice File',
    '',
    'The following packages declare a license in package metadata but do not',
    'ship a root-level license or notice file in the installed package:',
    ''
  )
  for (const dependency of missingNoticeFiles) {
    lines.push(`- ${dependency.name}@${dependency.version}: ${dependency.license}`)
  }
  lines.push('')
}

while (lines.at(-1) === '') lines.pop()
writeFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8')
console.log(
  `Generated ${outputPath} for ${dependencies.length} production dependencies (${noticeGroups.size} unique notice texts).`
)
