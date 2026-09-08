/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { readRepositoryFiles, repositoryText, searchRepository } from './workspaceRepository.ts'

async function fixture(fn: (root: string) => Promise<void>) {
  const root = await mkdtemp(resolve(tmpdir(), 'gllm-context-test-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}
test('batch reads ordered ranges and reports a missing member without discarding successful reads', async () => fixture(async root => {
  await writeFile(resolve(root,'a.ts'), 'first\nsecond\nthird\n')
  await writeFile(resolve(root,'b.ts'), 'fourth\nfifth')
  const result = JSON.parse(await readRepositoryFiles(root,{files:[{path:'a.ts',startLine:2,lineCount:1},{path:'missing'},{path:'b.ts',lineCount:1}]}))
  assert.match(result.content,/2\tsecond/); assert.match(result.content,/1\tfourth/)
  assert.doesNotMatch(result.content,/1\tfirst|3\tthird|2\tfifth/)
  assert.equal(result.errors.length,1); assert.equal(result.scope,'requested line ranges')
  assert.equal(result.complete,true); assert.equal(result.next,null)
}))
test('continuations recover every character of long Unicode lines and all remaining batch members', async () => fixture(async root => {
  const original = '🧪中文\\"\t'.repeat(1000)
  await writeFile(resolve(root,'long.ts'),original)
  await writeFile(resolve(root,'tail.ts'),'tail-line')
  let args: Record<string, unknown> = {files:[{path:'long.ts',lineCount:1},{path:'tail.ts',lineCount:1}],maxCharacters:1024}
  let recovered='', sawTail=false, pages=0
  while (true) {
    const result=JSON.parse(await readRepositoryFiles(root,args))
    for(const line of result.content.split('\n')) {
      const match=line.match(/^1(?:@\d+)?\t(.*)$/)
      if(match && match[1]==='tail-line') sawTail=true
      else if(match) recovered+=match[1]
    }
    assert.doesNotMatch(result.content,/\uFFFD/)
    if(result.complete) break
    assert.ok(++pages<100)
    args={...result.next,maxCharacters:1024}
  }
  assert.equal(recovered,original); assert.equal(sawTail,true)
}))
test('a changed file invalidates a continuation instead of mixing versions', async () => fixture(async root => {
  await writeFile(resolve(root,'a'),'x'.repeat(5000))
  const first=JSON.parse(await readRepositoryFiles(root,{files:[{path:'a',lineCount:1}],maxCharacters:1024}))
  await writeFile(resolve(root,'a'),'y'.repeat(5000))
  const next=JSON.parse(await readRepositoryFiles(root,first.next))
  assert.match(next.errors[0],/changed since/); assert.doesNotMatch(next.content,/y{20}/)
}))
test('search paginates stable results, counts occurrences and honors inherited ignore rules', async () => fixture(async root => {
  await mkdir(resolve(root,'src')); await mkdir(resolve(root,'ignored'))
  await writeFile(resolve(root,'.gitignore'),'ignored/\n*.log\n')
  await writeFile(resolve(root,'src','.ignore'),'!keep.log\n')
  await writeFile(resolve(root,'src','keep.log'),'needle needle')
  await writeFile(resolve(root,'src','skip.log'),'needle')
  await writeFile(resolve(root,'src','a.ts'),'before\nneedle one\nneedle two\nafter\n')
  await writeFile(resolve(root,'ignored','hidden.ts'),'needle')
  const first=JSON.parse(await searchRepository(root,{path:'src',query:'needle',mode:'files',limit:1}))
  assert.equal(first.occurrences,4); assert.equal(first.matchingFiles,2); assert.equal(first.records.length,1); assert.equal(first.complete,false)
  const second=JSON.parse(await searchRepository(root,first.next))
  assert.equal(second.records.length,1); assert.equal(second.complete,true)
  assert.notEqual(first.records[0],second.records[0])
  const content=JSON.parse(await searchRepository(root,{path:'src/a.ts',query:'needle',mode:'content'}))
  assert.equal(content.records.length,4)
  const summary=JSON.parse(await searchRepository(root,{query:'needle',mode:'summary'}))
  assert.equal(summary.occurrences,4); assert.deepEqual(summary.records,[])
  await writeFile(resolve(root,'src','a.ts'),'needle changed')
  await assert.rejects(searchRepository(root,first.next),/changed since/)
}))
test('binary skips are explicit and protected files, traversal and links stay inaccessible', async () => fixture(async root => {
  await writeFile(resolve(root,'.env'),'TOKEN=secret-needle')
  await writeFile(resolve(root,'visible.ts'),'needle')
  await writeFile(resolve(root,'binary.bin'),Buffer.from([0,1,2]))
  await assert.rejects(repositoryText(root,'.env'),/Protected/)
  await assert.rejects(repositoryText(root,'../outside'),/outside/)
  if(process.platform!=='win32') {
    await symlink(resolve(root,'.env'),resolve(root,'alias'))
    await assert.rejects(repositoryText(root,'alias'),/symbolic/)
  }
  const result=JSON.parse(await searchRepository(root,{query:'needle'}))
  assert.deepEqual(result.records,['"visible.ts"'])
  assert.equal(result.scanComplete,false); assert.ok(result.skippedCount>0)
  assert.doesNotMatch(JSON.stringify(result),/secret-needle/)
}))
test('long matching lines show the actual match and a precise follow-up line', async () => fixture(async root => {
  await writeFile(resolve(root,'long.ts'),'a'.repeat(20000)+'UNIQUE_TARGET'+'b'.repeat(20000))
  const result=JSON.parse(await searchRepository(root,{query:'UNIQUE_TARGET',mode:'content'}))
  assert.match(result.records[0],/UNIQUE_TARGET/); assert.match(result.records[0],/startLine=1/)
  assert.ok(result.records[0].length<750)
}))
