/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { WorkspaceVault, validateDeclarations } from './workspaceVault.ts'

test('vault persists ciphertext, exposes only status, isolates roots, updates and deletes credentials', async () => {
  const directory = await mkdtemp(resolve(tmpdir(),'gllm-vault-test-')), key = randomBytes(32)
  const encryption = {
    available: () => true,
    encrypt: (value: string) => { const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm', key, iv); const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),body]) },
    decrypt: (value: Buffer) => { const decipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12)); decipher.setAuthTag(value.subarray(12,28)); return Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8') }
  }
  try {
    const root=resolve(directory,'a'), other=resolve(directory,'b'), store=resolve(directory,'vault')
    await mkdir(root); await mkdir(other)
    const vault = new WorkspaceVault(store,encryption)
    await vault.declare(root,[{name:'ERP_TOKEN',description:'ERP access'}])
    await vault.update(root,[{name:'ERP_TOKEN',description:'ERP access',value:'high-entropy-test-secret'}])
    const status=await vault.status(root)
    assert.equal(status.variables[0].configured,true)
    assert.doesNotMatch(JSON.stringify(status), /high-entropy-test-secret/)
    const saved=await readFile(resolve(store,(await readdir(store))[0]),'utf8')
    assert.doesNotMatch(saved,/high-entropy-test-secret/)
    assert.equal((await vault.values(root,['ERP_TOKEN'])).ERP_TOKEN,'high-entropy-test-secret')
    assert.deepEqual(Object.keys(await vault.values(root,[])),[])
    assert.deepEqual((await vault.status(other)).variables,[])
    await Promise.all([vault.declare(root,[{name:'ERP_LOGIN',description:'Account'}]),vault.update(root,[{name:'ERP_TOKEN',value:'replacement'}])])
    assert.equal((await vault.status(root)).variables.length,2)
    await vault.update(root,[{name:'ERP_TOKEN',remove:true}])
    assert.deepEqual(Object.keys(await vault.values(root,['ERP_TOKEN'])),[])
    const unavailable=new WorkspaceVault(store,{...encryption,available:()=>false})
    await assert.rejects(unavailable.update(root,[{name:'ERP_TOKEN',value:'plaintext-not-allowed'}]),/plaintext storage is disabled/)
    assert.throws(()=>validateDeclarations([{name:'PATH'}]),/runtime/)
    assert.throws(()=>validateDeclarations([{name:'X'},{name:'X'}]),/duplicate/)
  } finally { await rm(directory,{recursive:true,force:true}) }
})
