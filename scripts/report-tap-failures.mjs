/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { readFile } from 'node:fs/promises'

// Republish TAP failures as workflow annotations.
//
// Reading this repository's Actions job logs needs admin rights, so a red test step
// used to publish exactly one line -- "Process completed with exit code 1" -- with no
// test name, expected value or actual value. That is how a launcher fault once cost a
// whole session to identify. Annotations are readable without credentials, so turn the
// TAP that the failing step already wrote into annotations.
//
// Deliberately dependency-free and incapable of failing the build: it runs on the
// failure path, where a second error would bury the first one.

const MAX_ANNOTATIONS = 8 // GitHub renders at most 10 error annotations per step
const MAX_MESSAGE_CHARS = 1200 // longer bodies are truncated by the UI anyway
const TAIL_LINES = 25

const logPath = process.argv[2]

function escapeAnnotationData(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function annotate(message) {
  process.stdout.write(`::error::${escapeAnnotationData(clip(message))}\n`)
}

function clip(value) {
  return value.length <= MAX_MESSAGE_CHARS ? value : `${value.slice(0, MAX_MESSAGE_CHARS)}... (${value.length - MAX_MESSAGE_CHARS} more characters)`
}

/**
 * Collect the `error` / `stack` bodies under one `not ok` record.
 *
 * node's TAP writer emits a one-line assertion message as a quoted scalar
 * (`error: 'text'`) and a multi-line one as a literal block (`error: |-`). Only
 * handling the block form silently dropped the most important message in the file:
 * `assert.fail('reason=...')` is one line, and that is exactly how the CI guard
 * reports a backend that cannot start a child.
 */
function unquoteScalar(value) {
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) } catch { return value.slice(1, -1) }
  }
  return value
}

function readBlockBodies(block) {
  const bodies = {}
  for (let index = 0; index < block.length; index++) {
    const key = /^\s*(error|stack): (?:\|-|\S)/.exec(block[index])?.[1]
    if (!key) continue
    const first = block[index].replace(/^\s*(error|stack): /, '')
    if (!/^\s*\|-/.test(first)) {
      const scalar = unquoteScalar(first.trim())
      if (scalar) bodies[key] ??= scalar
      continue
    }
    const body = []
    for (let next = index + 1; next < block.length; next++) {
      // A YAML key at the record's own indentation ends the literal block. Dedented
      // body lines never match, so assertion text is preserved verbatim.
      if (/^ {0,2}[A-Za-z_][A-Za-z0-9_]*: /.test(block[next]) && body.length > 0) break
      body.push(block[next].replace(/^ {4}/, ''))
    }
    const text = body.join('\n').trim()
    if (text) bodies[key] ??= text
  }
  return bodies
}

/** The assertion message carries the diagnosis; a stack would only crowd it out. */
function readBlockErrors(block) {
  const bodies = readBlockBodies(block)
  if (bodies.error) return [bodies.error]
  return bodies.stack ? [`(no assertion message reported)\n${bodies.stack}`] : []
}

function readFailures(lines) {
  const failures = []
  for (let index = 0; index < lines.length; index++) {
    const match = /^\s*not ok \d+ - (.*)$/.exec(lines[index])
    if (!match) continue
    const block = []
    for (let next = index + 1; next < lines.length && block.length < 80; next++) {
      if (/^\s*(not ok |ok |1\.\.|# )/.test(lines[next])) break
      block.push(lines[next])
    }
    const location = block.find(line => line.trimStart().startsWith('location:'))
    failures.push({
      title: match[1].replace(/\s*# (SKIP|TODO).*$/, '').trim(),
      location: location ? location.trim() : 'location not reported',
      details: readBlockErrors(block)
    })
  }
  return failures
}

function readSummary(lines) {
  const parts = []
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped']) {
    const hit = lines.filter(line => line.startsWith(`# ${key} `)).pop()
    if (hit) parts.push(hit.replace(/^# /, '').trim())
  }
  return parts.join(', ')
}

function report(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const failures = readFailures(lines)
  const summary = readSummary(lines)
  let used = 0
  if (summary || failures.length > 0) {
    annotate(`TAP summary: ${summary || 'no summary block was written'} | failing: ${failures.length}`)
    used++
  }
  if (failures.length > 0) {
    annotate(failures.map((failure, index) => `${index + 1}. ${failure.title}`).join('\n'))
    used++
    for (const failure of failures) {
      if (used >= MAX_ANNOTATIONS) break
      annotate(`${failure.title}\n${failure.location}\n${failure.details.join('\n\n') || 'no error body in the TAP record'}`)
      used++
    }
  }
  // A run can also die before writing any TAP (missing dependency, crashed worker).
  // The tail is then the only evidence, so it is worth one annotation.
  if (used < MAX_ANNOTATIONS) {
    const tail = lines.filter(line => line.trim() !== '').slice(-TAIL_LINES).join('\n')
    if (tail.trim()) annotate(`last ${TAIL_LINES} non-empty lines of ${logPath}:\n${tail}`)
  }
}

try {
  if (!logPath) throw new Error('usage: node scripts/report-tap-failures.mjs <tap-log>')
  report(await readFile(logPath, 'utf8'))
} catch (error) {
  annotate(`could not report TAP failures from ${logPath}: ${/** @type {Error} */ (error).message}`)
}
