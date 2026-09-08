/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { constants } from 'node:fs'
import { open, opendir, realpath, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve, matchesGlob } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { assertWorkspacePathAllowed, isProtectedWorkspacePath } from './workspaceAgentPolicy.ts'
import { integerOption, safeTextEnd } from './workspaceOutputStore.ts'

const MAX_TEXT_BYTES = 20 * 1024 * 1024
const MAX_SCAN_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 10_000
const MAX_RESPONSE = 12_000
const posix = (path: string) => path.replaceAll('\\', '/')
const shown = (path: string) => JSON.stringify(path)
export async function repositoryPath(root: string, input: unknown = '.') {
  if (typeof input !== 'string' || input.length > 1024 || isAbsolute(input) || input.includes('\0')) throw new Error('Use a relative workspace path of at most 1024 characters')
  assertWorkspacePathAllowed(input)
  const canonicalRoot = await realpath(root), path = resolve(canonicalRoot, input)
  const diff = relative(canonicalRoot, path)
  if (diff === '..' || diff.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(diff)) throw new Error('Path is outside the workspace')
  let current = canonicalRoot
  for (const segment of diff.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment)
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Repository tools do not follow symbolic links')
  }
  const actual = await realpath(path)
  if (actual !== path) throw new Error('Repository path changed or resolves through a link')
  assertWorkspacePathAllowed(relative(canonicalRoot, actual))
  return actual
}
export async function repositoryText(root: string, path: unknown) {
  const target = await repositoryPath(root, path)
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    const before = await file.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_TEXT_BYTES) throw new Error('Expected a regular text file up to 20 MiB; links and special files are excluded')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) {
      const part = await file.read(bytes, length, bytes.length - length, length)
      if (!part.bytesRead) break
      length += part.bytesRead
    }
    const after = await file.stat()
    if (length !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('File changed while reading; retry the read')
    const buffer = bytes.subarray(0, length)
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
    catch { throw new Error('Not valid UTF-8; convert explicitly or use a document tool') }
    if (text.includes('\0')) throw new Error('Binary content is excluded')
    return { text, bom: buffer.subarray(0, 3).equals(Buffer.from([239, 187, 191])), mode: before.mode, version: createHash('sha256').update(buffer).digest('hex').slice(0, 16), bytes: length }
  } finally { await file.close() }
}
interface ReadRange { path: string; startLine: number; lineCount: number; column: number; version?: string }
function readRange(value: unknown): ReadRange {
  if (!value || typeof value !== 'object') throw new Error('Expected file ranges')
  const entry = value as Record<string, unknown>
  if (typeof entry.path !== 'string' || entry.path.length > 1024) throw new Error('File path is required (max 1024 characters)')
  return { path: entry.path, startLine: integerOption(entry.startLine, 1, 1, 100_000_000), lineCount: integerOption(entry.lineCount, 200, 1, 10000), column: integerOption(entry.column, 0, 0, MAX_TEXT_BYTES), ...(entry.version === undefined ? {} : { version: String(entry.version) }) }
}
export async function readRepositoryFiles(root: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  if (!Array.isArray(args.files) || !args.files.length || args.files.length > 32) throw new Error('Read 1–32 file ranges at a time')
  const pending = args.files.map(readRange), results: string[] = [], errors: string[] = [], next: ReadRange[] = []
  let budget = integerOption(args.maxCharacters, MAX_RESPONSE, 1024, MAX_RESPONSE)
  // Continuation parameters are metadata outside the content budget; the agent's
  // aggregate output limiter bounds the complete serialized response as well.
  for (let index = 0; index < pending.length; index++) {
    signal?.throwIfAborted()
    const range = pending[index]
    if (budget < 160) { next.push(...pending.slice(index)); break }
    try {
      const file = await repositoryText(root, range.path)
      if (range.version && file.version !== range.version) throw new Error('File changed since the previous page; restart this file from startLine=1 without version')
      const lines = file.text.split('\n', 500_001)
      if (lines.length > 500_000) throw new Error('File exceeds 500000 lines; use character-range read_file')
      if (file.text.endsWith('\n')) lines.pop()
      if (file.text === '') lines.length = 0
      const end = Math.min(lines.length, range.startLine - 1 + range.lineCount)
      if (range.startLine > lines.length + 1 || range.column > (lines[range.startLine - 1]?.length ?? 0) || (range.column > 0 && /[\uDC00-\uDFFF]/.test(lines[range.startLine - 1]?.[range.column] ?? ''))) throw new Error('Requested line or column is outside the file')
      const header = `File ${shown(range.path)}; version=${file.version}; totalLines=${lines.length}\n`
      results.push(header); budget -= header.length
      let line = range.startLine - 1, column = range.column
      for (; line < end; line++) {
        signal?.throwIfAborted()
        const prefix = `${line + 1}${column ? `@${column}` : ''}\t`, content = lines[line].slice(column)
        if (prefix.length + content.length + 1 <= budget) {
          results.push(prefix + content + '\n'); budget -= prefix.length + content.length + 1; column = 0
        } else {
          const count = safeTextEnd(content, Math.max(0, budget - prefix.length - 1))
          if (count > 0) { results.push(prefix + content.slice(0, count) + '\n'); budget -= prefix.length + count + 1; column += count }
          next.push({ path: range.path, startLine: line + 1, lineCount: end - line, column, version: file.version })
          break
        }
      }
      if (line === end && end < lines.length) results.push(`[Range complete; more lines exist. Next range starts at line ${end + 1}.]\n`)
    } catch (error) { errors.push(`${shown(range.path)}: ${error instanceof Error ? error.message : 'Read failed'}`) }
  }
  return JSON.stringify({ content: results.join(''), errors, scope: 'requested line ranges', complete: next.length === 0, next: next.length ? { files: next } : null })
}
interface Traversal { files: string[]; skipped: string[]; complete: boolean }
async function discover(root: string, start: string, signal?: AbortSignal): Promise<Traversal> {
  const result: Traversal = { files: [], skipped: [], complete: true }
  const rootReal = await realpath(root)
  let entries = 0
  const deadline = Date.now() + 10_000
  interface Rules { base: string; matcher: Ignore }
  async function loadRules(path: string, inherited: Rules[]) {
    const rules = [...inherited]
    for (const name of ['.gitignore', '.ignore']) {
      try {
        const file = await repositoryText(rootReal, relative(rootReal, resolve(path, name)))
        if (file.bytes > 65536) throw new Error('ignore file exceeds 64 KiB')
        rules.push({ base: path, matcher: ignore().add(file.text) })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { result.skipped.push(`${shown(posix(relative(rootReal, resolve(path, name))))}: invalid ignore file`); result.complete = false }
      }
    }
    return rules
  }
  async function visit(path: string, inherited: Rules[]) {
    signal?.throwIfAborted()
    if (++entries > MAX_ENTRIES || Date.now() > deadline) { result.complete = false; return }
    const info = await lstat(path)
    if (info.isSymbolicLink()) { result.skipped.push(`${shown(posix(relative(rootReal, path)))}: symbolic link`); return }
    if (info.isFile()) { result.files.push(posix(relative(rootReal, path))); return }
    if (!info.isDirectory()) { result.skipped.push(`${shown(posix(relative(rootReal, path)))}: special file`); return }
    const rules = await loadRules(path, inherited)
    const directory = await opendir(path)
    for await (const entry of directory) {
      if (entries >= MAX_ENTRIES || Date.now() > deadline) { result.complete = false; break }
      const child = resolve(path, entry.name), name = posix(relative(rootReal, child))
      if (isProtectedWorkspacePath(name)) continue
      let ignored = false
      for (const rule of rules) {
        const match = rule.matcher.test(posix(relative(rule.base, child)) + (entry.isDirectory() ? '/' : ''))
        if (match.ignored) ignored = true
        else if (match.unignored) ignored = false
      }
      if (ignored) continue
      try { await visit(child, rules) }
      catch (error) { signal?.throwIfAborted(); result.skipped.push(`${shown(name)}: ${error instanceof Error ? error.message : 'Unreadable'}`) }
    }
  }
  let inherited: Rules[] = []
  if (start !== rootReal) {
    const ancestors: string[] = []
    let parent = dirname(start)
    while (parent !== rootReal) { ancestors.unshift(parent); parent = dirname(parent) }
    for (const ancestor of [rootReal, ...ancestors]) inherited = await loadRules(ancestor, inherited)
  }
  await visit(start, inherited)
  result.files.sort()
  return result
}
export async function searchRepository(root: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const start = await repositoryPath(root, args.path ?? '.')
  const mode = args.mode ?? 'files'
  if (!['files', 'content', 'count', 'summary', 'paths'].includes(String(mode))) throw new Error('Invalid search mode')
  const query = String(args.query ?? '')
  if (mode !== 'paths' && (!query || query.length > 1024 || /[\r\n]/.test(query))) throw new Error('Use a literal search query of 1–1024 characters')
  const glob = String(args.glob ?? '**/*')
  if (glob.length > 256 || /[{}()[\]]/.test(glob)) throw new Error('Use a simple path glob with *, ** and ?')
  const offset = integerOption(args.offset, 0, 0, MAX_ENTRIES * 100), limit = integerOption(args.limit, 40, 1, 200), context = integerOption(args.contextLines, 1, 0, 5)
  const found = await discover(root, start, signal), records: string[] = [], skips = [...found.skipped]
  let recordCount = 0, pageCharacters = 0, pageFull = false
  const appendRecord = (record: string) => {
    if (!pageFull && recordCount >= offset && records.length < limit && pageCharacters + record.length <= MAX_RESPONSE - 2000) { records.push(record); pageCharacters += record.length }
    else if (recordCount >= offset) pageFull = true
    recordCount++
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ start, mode, query, glob, context, caseSensitive: args.caseSensitive === true, skipped: found.skipped, complete: found.complete }))
  let matches = 0, matchedFiles = 0, bytes = 0, candidates = 0, complete = found.complete
  const needle = args.caseSensitive === true ? query : query.toLowerCase()
  const deadline = Date.now() + 10_000
  for (const path of found.files) {
    signal?.throwIfAborted()
    if (Date.now() > deadline) { complete = false; break }
    if (!matchesGlob(path, glob)) continue
    candidates++
    if (mode === 'paths') { appendRecord(shown(path)); fingerprint.update(path + '\0'); continue }
    try {
      const file = await repositoryText(root, path)
      bytes += file.bytes
      if (bytes > MAX_SCAN_BYTES) { complete = false; break }
      fingerprint.update(path + '\0' + file.version)
      const lines = file.text.split('\n', 500_001), indices: number[] = []
      if (lines.length > 500_000) throw new Error('File exceeds 500000 lines; narrow the input')
      let count = 0
      lines.forEach((line, index) => {
        const haystack = args.caseSensitive === true ? line : line.toLowerCase()
        let at = 0, occurrences = 0
        while ((at = haystack.indexOf(needle, at)) !== -1) { occurrences++; at += needle.length }
        if (occurrences) { count += occurrences; indices.push(index) }
      })
      if (!count) continue
      matchedFiles++; matches += count
      if (mode === 'files') appendRecord(shown(path))
      else if (mode === 'count') appendRecord(`${shown(path)}: ${count}`)
      else if (mode === 'content') {
        let last = -1
        for (const index of indices) {
          const first = Math.max(last + 1, index - context), end = Math.min(lines.length - 1, index + context)
          for (let line = first; line <= end; line++) {
            // Snip very long lines around the hit, not blindly at the beginning.
            const original = lines[line], hit = (args.caseSensitive === true ? original : original.toLowerCase()).indexOf(needle)
            const from = Math.max(0, hit - 120), to = Math.min(original.length, from + 600)
            appendRecord(`${shown(path)}:${line + 1}:${from ? '…' : ''}${original.slice(from, to)}${to < original.length ? `… [read_files startLine=${line + 1}]` : ''}`)
          }
          last = end
        }
      }

    } catch (error) { signal?.throwIfAborted(); skips.push(`${shown(path)}: ${error instanceof Error ? error.message : 'Skipped'}`); fingerprint.update(path + '\0SKIP') }
  }
  const version = fingerprint.digest('hex').slice(0, 16)
  if (args.version !== undefined && args.version !== version) throw new Error('Search inputs changed since the previous page; restart at offset=0 without version')
  const page = records, end = offset + page.length
  if (offset > recordCount) throw new Error('Offset is beyond search results')
  return JSON.stringify({ mode, version, records: page, matchingFiles: matchedFiles, occurrences: matches, candidates, totalResults: recordCount, scanComplete: complete && skips.length === 0, skipped: skips.slice(0, 20), skippedCount: skips.length, complete: complete && skips.length === 0 && end >= recordCount, next: end < recordCount ? { ...args, offset: end, version } : null, ...(complete ? {} : { note: 'Scan limit reached; narrow path or glob. Totals describe only scanned files.' }) })
}
