/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
// Run with node --experimental-strip-types. This measures tool payloads, not bills.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { readRepositoryFiles, searchRepository } from '../src/main/workspaceRepository.ts'
import { WorkspaceOutputStore } from '../src/main/workspaceOutputStore.ts'
const root = resolve(import.meta.dirname, '..')
const targets = [
  { path: 'src/main/workspaceNative.ts', query: 'const selected = selectWorkspaceEnvironment', before: 1, count: 20 },
  { path: 'src/main/workspaceProcess.ts', query: 'const stop = (error: Error)', before: 3, count: 17 }
]
const baseline = [], optimized = [], ranges = []
for (const target of targets) {
  const text = await readFile(resolve(root, target.path), 'utf8')
  const line = text.split('\n').findIndex(value => value.includes(target.query)) + 1
  if (!line) throw new Error('Benchmark target no longer exists')
  baseline.push({ tool: 'read_file', arguments: { path: target.path }, output: text.slice(0, 36000) })
  const args = { path: target.path, query: target.query, mode: 'content', contextLines: 0 }
  optimized.push({ tool: 'search_text', arguments: args, output: await searchRepository(root, args) })
  ranges.push({ path: target.path, startLine: Math.max(1, line - target.before), lineCount: target.count })
}
const batch = await readRepositoryFiles(root, { files: ranges })
for (const target of targets) if (!batch.includes(target.query)) throw new Error('Required fact was lost')
optimized.push({ tool: 'read_files', arguments: { files: ranges }, output: batch })
const store = new WorkspaceOutputStore()
const log = Array.from({ length: 600 }, (_, i) => `[test ${i + 1}] project=workspace duration=${(i * 17) % 101}ms status=passed\n`).join('') + 'SUMMARY: 600 passed; exit=0'
const report = {
  methodology: 'Serialized tool-call arguments and results only; excludes model reasoning, system prompts and tool schema overhead. Known task: inspect credential selection and timeout/output limits. Initial selective context is not equivalent to reading every source byte.',
  cases: [
    { name: 'targeted-source-inspection', baseline: JSON.stringify(baseline), optimized: JSON.stringify(optimized), requiredFactsPreserved: true, baselineCalls: baseline.length, optimizedCalls: optimized.length },
    { name: 'long-command-output-first-page', baseline: log.slice(0, 24000), optimized: store.capture('log', log).output.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '00000000-0000-4000-8000-000000000000'), note: 'Initial response only. The new output retains the final summary and supports exact retrieval of the omitted middle. Reading all pages costs additional tokens.' }
  ]
}
const path = process.argv[2] || '/tmp/gllm-context-benchmark.json'
await writeFile(path, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ payload: path, cases: report.cases.map(c => ({ name: c.name, baselineCharacters: c.baseline.length, optimizedCharacters: c.optimized.length, reductionPercent: Math.round(100*(1-c.optimized.length/c.baseline.length)) })) }, null, 2))

if (process.argv[3]) {
  const require = createRequire(resolve(process.argv[3], 'package.json'))
  const { getEncoding } = require('js-tiktoken')
  const tokenizers = ['o200k_base', 'cl100k_base'].map(name => [name, getEncoding(name)])
  const measured = { referenceTokenizer: 'js-tiktoken 1.0.21 (offline rank tables; not provider billing)', methodology: report.methodology, cases: report.cases.map(({ baseline, optimized, ...rest }) => ({ ...rest, characters: { baseline: baseline.length, optimized: optimized.length }, tokenizers: Object.fromEntries(tokenizers.map(([name, encoder]) => {
    const old = encoder.encode(baseline, [], []).length, next = encoder.encode(optimized, [], []).length
    return [name, { baseline: old, optimized: next, reductionPercent: Math.round(1000 * (1 - next / old)) / 10 }]
  })) })) }
  await writeFile(resolve(root, 'docs/benchmarks/workspace-context.json'), JSON.stringify(measured, null, 2) + '\n')
  console.log(JSON.stringify(measured, null, 2))
}
