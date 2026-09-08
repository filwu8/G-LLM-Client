/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { access, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareNativeCommand, runNativeCommand } from './workspaceNative.ts'
import type { WorkspaceDiagnosticResult, WorkspaceDiagnosticOptions } from '../shared/types.ts'

/** Fixed probes only, no model code, user files, credentials or business endpoints. */
export async function diagnoseWorkspaceExecution(root: string, options: WorkspaceDiagnosticOptions): Promise<WorkspaceDiagnosticResult> {
  const mode = options.executionMode === 'host' ? 'host' : 'sandbox', network = options.sandboxNetwork === true
  const checks: WorkspaceDiagnosticResult['checks'] = []
  const add = (id: WorkspaceDiagnosticResult['checks'][number]['id'], status: 'passed' | 'failed' | 'skipped', detail = '') => checks.push({ id, status, detail: detail.slice(0, 2000) })
  try {
    const path = await realpath(root)
    if (!(await stat(path)).isDirectory()) throw new Error('Expected a folder')
    await access(path, constants.R_OK | constants.W_OK); add('folder', 'passed')
  } catch (error) {
    add('folder', 'failed', String(error)); return { checkedAt: Date.now(), checks }
  }
  const directory = await mkdtemp(join(tmpdir(), 'gllm-health-')), work = join(directory, 'work'), outside = join(directory, 'outside.txt')
  try {
    await mkdir(work); await writeFile(outside, 'outside-probe')
    const settings = { executionMode: mode, sandboxNetwork: network } as const
    try {
      const code = `import sys,json,socket\nr={"python":sys.version.split()[0],"executable":sys.executable}\nopen("health.txt","w").write("ok")\ntry:\n open(${JSON.stringify(outside)}).read()\n r["outsideBlocked"]=False\nexcept (PermissionError, FileNotFoundError):\n r["outsideBlocked"]=True\ntry:\n open(${JSON.stringify(outside)},"w").write("unexpected-write")\n r["outsideWriteBlocked"]=False\nexcept (PermissionError, FileNotFoundError):\n r["outsideWriteBlocked"]=True\nif ${mode === 'host' || network ? 'True' : 'False'}:\n try:\n  socket.getaddrinfo("example.com",443)\n  r["dns"]=True\n except Exception as e:\n  r["dns"]=str(e)\n if r["dns"] is True:\n  try:\n   socket.create_connection(("example.com",443),timeout=5).close()\n   r["network"]=True\n  except Exception as e:\n   r["network"]=str(e)\nprint("GLLM_CHECK:"+json.dumps(r))`
      const result = await runNativeCommand(await prepareNativeCommand(work, 'run_python', { code }, [], settings), {}, undefined, { timeoutMs: 15000 })
      if (result.exitCode !== 0) throw new Error(result.output)
      const report = JSON.parse(result.output.split('GLLM_CHECK:')[1].split('\n')[0])
      add('python', 'passed', `${report.python} · ${report.executable}`)
      add('writeback', (await readFile(join(work, 'health.txt'), 'utf8')) === 'ok' ? 'passed' : 'failed')
      add('isolation', mode === 'host' ? 'skipped' : report.outsideBlocked && report.outsideWriteBlocked && (await readFile(outside, 'utf8')) === 'outside-probe' ? 'passed' : 'failed')
      add('dns', mode === 'sandbox' && !network ? 'skipped' : report.dns === true ? 'passed' : 'failed', typeof report.dns === 'string' ? report.dns : '')
      add('network', mode === 'sandbox' && !network ? 'skipped' : report.network === true ? 'passed' : 'failed', typeof report.network === 'string' ? report.network : '')
    } catch (error) { add('python', 'failed', String(error)) }
    try {
      // A cold Windows PowerShell session loads .NET and system modules before
      // reaching Python; allow that measured startup cost within a bounded probe.
      const result = await runNativeCommand(await prepareNativeCommand(work, 'run_shell', { code: process.platform === 'win32' ? 'python --version' : 'python3 --version' }, [], settings), {}, undefined, { timeoutMs: process.platform === 'win32' ? 30000 : 15000 })
      add('shell', result.exitCode === 0 && /Python 3\./.test(result.output) ? 'passed' : 'failed', result.output)
    } catch (error) { add('shell', 'failed', String(error)) }
  } finally { await rm(directory, { recursive: true, force: true }) }
  return { checkedAt: Date.now(), checks }
}
