/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { WorkspaceJobs, type JobResult } from './workspaceJobs.ts'
import { runWorkspaceProcess } from './workspaceProcess.ts'
import { prepareNativeCommand, runNativeCommand } from './workspaceNative.ts'

function controlled(jobs: WorkspaceJobs) {
  let output!: (stream: 'stdout' | 'stderr', chunk: Buffer) => void
  let complete!: (result: JobResult) => void
  const result = JSON.parse(jobs.start(async (signal, emit) => {
    output = emit
    return new Promise<JobResult>((resolve, reject) => { complete = resolve; signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }) })
  }))
  return { id: result.id, emit: (text: string, stream: 'stdout' | 'stderr' = 'stdout') => output(stream, Buffer.from(text)), complete: () => complete({ output: 'done', exitCode: 0, changedFiles: ['result.txt'] }) }
}
test('incremental logs withhold split secrets, overlapping prefixes and partial Unicode; completion collected once', async () => {
  const jobs = new WorkspaceJobs(); jobs.configure({ TOKEN: 'secret-123', PREFIX: 'secret', OVERLAP: 'abcab' })
  const job = controlled(jobs); await Promise.resolve()
  job.emit('hello sec'); assert.equal(JSON.parse((await jobs.read({ id: job.id })).output).stdout, 'hello ')
  job.emit('ret-'); assert.equal(JSON.parse((await jobs.read({ id: job.id })).output).stdout, '')
  job.emit('123! abcab'); job.emit('err\n', 'stderr')
  const second = JSON.parse((await jobs.read({ id: job.id })).output)
  assert.equal(second.stdout, '[REDACTED]! [REDACTED]'); assert.equal(second.stderr, 'err\n')
  assert.throws(() => jobs.start(async () => ({ output: '', exitCode: 0 })), /active job/)
  await assert.rejects(new WorkspaceJobs().read({ id: job.id }), /not found/)
  job.complete()
  const final = await jobs.read({ id: job.id, waitMs: 1000 })
  assert.deepEqual(final.changedFiles, ['result.txt']); assert.equal(final.exitCode, 0)
  assert.equal(jobs.pending, false)
  assert.equal((await jobs.read({ id: job.id })).changedFiles, undefined)
  assert.equal(JSON.parse((await jobs.read({ id: job.id })).output).stdout, '')
  await jobs.dispose()
})
test('logs paginate without duplication, keep UTF-8 across chunks and report truncation', async () => {
  const jobs = new WorkspaceJobs()
  const unicode = Buffer.from('中文🧪'.repeat(1500))
  const { id } = JSON.parse(jobs.start(async (_signal, emit) => {
    for (let i = 0; i < unicode.length; i += 5) emit('stdout', unicode.subarray(i, i + 5))
    return { output: 'done', exitCode: 0 }
  }))
  let recovered = '', count = 0
  do {
    const page = JSON.parse((await jobs.read({ id, waitMs: 1000 })).output)
    recovered += page.stdout
    if (!page.next) break
    assert.ok(++count < 20)
  } while (true)
  assert.equal(recovered, unicode.toString('utf8'))
  const large = JSON.parse(jobs.start(async (_signal, emit) => { emit('stdout', Buffer.alloc(2 * 1024 * 1024, 120)); return { output: 'done', exitCode: 0 } }))
  const page = JSON.parse((await jobs.read({ id: large.id, waitMs: 1000 })).output)
  assert.equal(page.truncated, true); assert.equal(page.more, true)
  assert.equal(jobs.pending, false, 'completion collection must not require draining all logs')
  const tail = JSON.parse((await jobs.read({ id: large.id, tail: true })).output)
  assert.ok(tail.skippedCharacters > 0); assert.equal(tail.more, false)
  assert.equal(tail.stdout.length, 3000)
  await jobs.dispose()
})
test('stop and disposal cancel real processes; truncated output does not kill a successful job', async () => {
  const jobs = new WorkspaceJobs()
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-job-test-'))
  try {
    const { id } = JSON.parse(jobs.start(async (signal, onOutput) => {
      const result = await runWorkspaceProcess({ executable: process.execPath, args: ['-e', 'console.log("started"); setInterval(()=>{},1000)'], cwd: root, env: {}, signal, onOutput })
      return { output: 'done', exitCode: result.exitCode }
    }))
    await Promise.resolve()
    const stopped = JSON.parse((await jobs.stop(id)).output)
    assert.equal(stopped.status, 'failed'); assert.match(stopped.error, /cancelled/)
    const chunks: Buffer[] = []
    const result = await runWorkspaceProcess({ executable: process.execPath, args: ['-e', 'console.log("x".repeat(10000))'], cwd: root, env: {}, maxOutputBytes: 100, outputOverflow: 'truncate', onOutput: (_stream, chunk) => chunks.push(chunk) })
    assert.equal(result.exitCode, 0); assert.equal(Buffer.concat(chunks).length, 100)
    jobs.start(async signal => { await runWorkspaceProcess({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: root, env: {}, signal }); return { output: '', exitCode: 0 } })
    await jobs.dispose(); assert.equal(jobs.busy, false)
  } finally { await jobs.dispose(); await rm(root, { recursive: true, force: true }) }
})
test('background Python retains OS sandbox and writes back only a completed successful job', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-job-sandbox-')), jobs = new WorkspaceJobs()
  try {
    const command = await prepareNativeCommand(root, 'run_python', { code: 'import time\nprint("phase1", flush=True)\ntime.sleep(0.15)\nopen("result.txt","w").write("sandbox")\nprint("phase2", flush=True)' }, [])
    const { id } = JSON.parse(jobs.start((signal, onOutput) => runNativeCommand(command, {}, signal, { onOutput, timeoutMs: 5000 })))
    let page = JSON.parse((await jobs.read({ id, waitMs: 10000 })).output)
    let stdout = page.stdout
    // Windows also prepares the trusted .NET launcher before the script's own
    // five-second execution deadline starts. Collect incremental output while it runs.
    for (let attempt = 0; page.status === 'running' && attempt < 2; attempt++) {
      page = JSON.parse((await jobs.read({ id, waitMs: 30000 })).output)
      stdout += page.stdout
    }
    assert.equal(page.status, 'completed', page.error ?? page.result); assert.match(stdout, /phase1[\s\S]*phase2/)
    assert.equal(await readFile(resolve(root, 'result.txt'), 'utf8'), 'sandbox')
  } finally { await jobs.dispose(); await rm(root, { recursive: true, force: true }) }
})
