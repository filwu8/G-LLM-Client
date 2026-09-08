/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { prepareNativeCommand, runNativeCommand } from './workspaceNative.ts'
import { applySandboxSnapshot, createSandboxSnapshot } from './workspaceSandboxFiles.ts'
import { bubblewrapArgs, linuxSeccomp, sandboxBackend, seatbeltProfile } from './workspaceSandbox.ts'

const supported = ['darwin', 'linux', 'win32'].includes(process.platform)
async function fixture() { return mkdtemp(resolve(tmpdir(), 'gllm-isolation-test-')) }
test('native sandbox denies outside writes, private inputs and network, including a subprocess', { skip: !supported }, async () => {
  const root = await fixture(), outside = await fixture()
  try {
    await writeFile(resolve(root, '.env'), 'TOKEN=private-do-not-read')
    await writeFile(resolve(outside, 'secret.txt'), 'outside-do-not-read')
    const code = `import os, socket, subprocess, sys, json
checks = {}
for label, path in [('credential', '.env'), ('outside', ${JSON.stringify(resolve(outside, 'secret.txt'))}), ('volume_alias', ${JSON.stringify('/System/Volumes/Data' + resolve(outside, 'secret.txt'))})]:
 try:
  open(path).read()
  checks[label] = False
 except OSError:
  checks[label] = True
try:
 open(${JSON.stringify(resolve(outside, 'escaped.txt'))}, 'w').write('escaped')
 checks['write'] = False
except OSError:
 checks['write'] = True
s = socket.socket(); s.settimeout(0.5)
try:
 s.connect(('127.0.0.1', 9)); checks['network'] = False
except OSError:
 checks['network'] = True
s.close()
child = subprocess.run([sys.executable, '-I', '-c', ${JSON.stringify(`open(${JSON.stringify(resolve(outside, 'child.txt'))}, 'w').write('escaped')`)}], capture_output=True)
checks['child'] = child.returncode != 0
with open('checks.json','w') as f: json.dump(checks,f)
print('checks complete')`
    const result = await runNativeCommand(await prepareNativeCommand(root, 'run_python', { code }, []), {})
    assert.equal(result.exitCode, 0, result.output)
    assert.deepEqual(JSON.parse(await readFile(resolve(root, 'checks.json'), 'utf8')), { credential: true, outside: true, volume_alias: true, write: true, network: true, child: true })
    await assert.rejects(readFile(resolve(outside, 'escaped.txt')), { code: 'ENOENT' })
    await assert.rejects(readFile(resolve(outside, 'child.txt')), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})
test('sandbox network opt-in is enforced against an actual listening service', { skip: !supported || process.platform === 'win32' }, async () => {
  const root = await fixture(), server = createServer(socket => socket.end('hello'))
  await new Promise<void>(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
  const port = (server.address() as { port: number }).port
  try {
    const code = `import socket\ns=socket.create_connection(('127.0.0.1',${port}),timeout=1)\nprint(s.recv(32).decode())\ns.close()`
    const base = await prepareNativeCommand(root, 'run_python', { code }, [])
    const denied = await runNativeCommand(base, {})
    assert.notEqual(denied.exitCode, 0, denied.output)
    const allowed = await runNativeCommand({ ...base, sandboxNetwork: true }, {})
    assert.equal(allowed.exitCode, 0, allowed.output)
    assert.match(allowed.output, /hello/)
  } finally { server.close(); await rm(root, { recursive: true, force: true }) }
})
test('sandbox failure discards writes; snapshot conflicts and links never overwrite originals', async () => {
  const root = await fixture()
  let snapshot: Awaited<ReturnType<typeof createSandboxSnapshot>> | undefined
  try {
    await writeFile(resolve(root, 'data.txt'), 'before')
    snapshot = await createSandboxSnapshot(root)
    await writeFile(resolve(snapshot.work, 'data.txt'), 'agent')
    await writeFile(resolve(root, 'data.txt'), 'user-concurrent-edit')
    await assert.rejects(applySandboxSnapshot(snapshot), /changed during/)
    assert.equal(await readFile(resolve(root, 'data.txt'), 'utf8'), 'user-concurrent-edit')
    if (process.platform !== 'win32') {
      await symlink('/tmp', resolve(snapshot.work, 'link'))
      await assert.rejects(applySandboxSnapshot(snapshot), /symbolic link/)
    }
    if (supported) {
      const result = await runNativeCommand(await prepareNativeCommand(root, 'run_python', { code: 'open("discard.txt","w").write("discard"); raise RuntimeError("intentional")' }, []), {})
      assert.notEqual(result.exitCode, 0)
      await assert.rejects(readFile(resolve(root, 'discard.txt')), { code: 'ENOENT' })
    }
  } finally { if (snapshot) await rm(snapshot.directory, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }) }
})
test('platform policies default to no network, include seccomp and never invoke a host fallback', () => {
  assert.equal(sandboxBackend('win32'), 'AppContainer + Job Object')
  assert.equal(sandboxBackend('linux'), 'Bubblewrap + seccomp')
  const profile = seatbeltProfile('/work"quoted', '/scratch', '/usr/bin', false)
  assert.match(profile, /deny default/); assert.doesNotMatch(profile, /allow network/)
  assert.match(profile, /work\\"quoted/)
  const args = bubblewrapArgs('/work','/scratch','/usr/bin/python3',['-c','print(1)'],'/work',false,['/usr'])
  assert.ok(args.includes('--unshare-all')); assert.ok(args.includes('--seccomp')); assert.ok(!args.includes('--share-net'))
  for (const arch of ['x64','arm64']) assert.equal(linuxSeccomp(arch).length % 8, 0)
  assert.throws(() => linuxSeccomp('ia32'), /Unsupported/)
})

test('seccomp blocks Unix IPC and cross-process access while preserving ordinary syscalls', () => {
  function evaluate(arch: string, syscall: number, family = 0) {
    const program = linuxSeccomp(arch)
    let register = 0
    for (let pc = 0; pc < program.length / 8; pc++) {
      const code = program.readUInt16LE(pc * 8), jt = program[pc * 8 + 2], jf = program[pc * 8 + 3], value = program.readUInt32LE(pc * 8 + 4)
      if (code === 0x20) register = value === 4 ? (arch === 'x64' ? 0xc000003e : 0xc00000b7) : value === 0 ? syscall : family
      else if (code === 0x15) pc += register === value ? jt : jf
      else if (code === 0x35) pc += register >= value ? jt : jf
      else if (code === 0x06) return value
      else throw new Error('Unknown BPF instruction')
    }
    throw new Error('Missing BPF verdict')
  }
  for (const arch of ['x64','arm64']) {
    assert.equal(evaluate(arch, arch === 'x64' ? 41 : 198, 1), 0x50001)
    assert.equal(evaluate(arch, arch === 'x64' ? 53 : 199, 1), 0x50001)
    assert.equal(evaluate(arch, arch === 'x64' ? 41 : 198, 2), 0x7fff0000)
    assert.equal(evaluate(arch, arch === 'x64' ? 101 : 117), 0x50001)
    assert.equal(evaluate(arch, arch === 'x64' ? 1 : 64), 0x7fff0000)
  }
  assert.equal(evaluate('x64', 0x40000029, 1), 0x50001)
})

test('platform shell creates a result inside the sandbox', { skip: !supported }, async () => {
  const root = await fixture()
  try {
    const code = process.platform === 'win32' ? '[System.IO.File]::WriteAllText("shell.txt", "sandbox-shell"); Write-Output "shell-ok"' : 'printf sandbox-shell > shell.txt; echo shell-ok'
    const result = await runNativeCommand(await prepareNativeCommand(root, 'run_shell', { code }, []), {})
    assert.equal(result.exitCode, 0, result.output)
    assert.equal(await readFile(resolve(root, 'shell.txt'), 'utf8'), 'sandbox-shell')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('macOS DNS grants are narrow and only included when networking is enabled', () => {
  const denied = seatbeltProfile('/work', '/scratch', '/usr/bin', false)
  const allowed = seatbeltProfile('/work', '/scratch', '/usr/bin', true)
  assert.doesNotMatch(denied, /mDNSResponder|opendirectoryd/)
  assert.match(allowed, /literal "\/private\/var\/run\/mDNSResponder"/)
  assert.match(allowed, /com\.apple\.system\.opendirectoryd\.libinfo/)
  assert.doesNotMatch(allowed, /allow network-outbound\)/)
})
