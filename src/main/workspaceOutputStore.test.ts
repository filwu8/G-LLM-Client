/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceOutputStore, TOOL_ROUND_CHARACTERS } from './workspaceOutputStore.ts'
import { redactWorkspaceSecrets } from './workspaceAgentPolicy.ts'
import { prepareWorkspaceMessagesForRequest } from './workspaceContext.ts'

test('a bounded preview retains both ends and recovers exact redacted Unicode output without rerunning', () => {
  const store=new WorkspaceOutputStore(), original='head\n'+'secret-fixture\n中文🧪\\"\t'.repeat(3000)+'\nFINAL EXIT CODE 7'
  const safe=redactWorkspaceSecrets(original,{TOKEN:'secret-fixture'})
  const result=store.capture('call',safe,4000)
  assert.ok(result.output.length<=4000); assert.match(result.output,/FINAL EXIT CODE 7/)
  assert.doesNotMatch(result.output,/secret-fixture/)
  const reference=store.referenceForCall('call')!
  const args=JSON.parse(reference.match(/read_tool_output (\{.*?\})/)![1])
  let recovered='',pages=0
  while(true) {
    const pageText=store.read(args,4000)
    assert.ok(pageText.length<=4000)
    const page=JSON.parse(pageText)
    recovered+=page.content
    if(page.complete) break
    assert.ok(++pages<100); Object.assign(args,page.next)
  }
  assert.equal(recovered,safe)
})
test('tool batches share a budget, stores are run-scoped and eviction is explicit', () => {
  const store=new WorkspaceOutputStore(2_000_000,6)
  let remaining=TOOL_ROUND_CHARACTERS
  for(let i=0;i<6;i++) {
    const result=store.capture(`call${i}`,'line\n'.repeat(10000),Math.floor(remaining/(6-i)))
    remaining-=result.output.length
  }
  assert.ok(remaining>=0)
  const reference=store.referenceForCall('call0')!
  const args=JSON.parse(reference.match(/read_tool_output (\{.*?\})/)![1])
  assert.throws(()=>new WorkspaceOutputStore().read(args),/unavailable|evicted/)
  store.capture('next','next'.repeat(1000))
  assert.throws(()=>store.read(args),/unavailable|evicted/)
})
test('history compaction supplies a recoverable reference and leaves unexecuted code exact', () => {
  const store=new WorkspaceOutputStore(), text='old result\n'.repeat(1000), code='pending code\n'.repeat(1000)
  store.capture('old',text)
  const messages:any[]=[{role:'assistant',content:null,tool_calls:[{id:'old',type:'function',function:{name:'run_shell',arguments:'{}'}}]}, {role:'tool',tool_call_id:'old',content:text}, {role:'assistant',content:null,tool_calls:[{id:'new',type:'function',function:{name:'inspect_file',arguments:'{}'}}]}, {role:'tool',tool_call_id:'new',content:'latest exact'}, {role:'assistant',content:null,tool_calls:[{id:'pending',type:'function',function:{name:'run_python',arguments:JSON.stringify({code})}}]}]
  const prepared=prepareWorkspaceMessagesForRequest(messages,id=>store.referenceForCall(id))
  assert.match(String(prepared.messages[1].content),/read_tool_output/)
  assert.equal(prepared.messages[3].content,'latest exact')
  assert.equal(JSON.parse(prepared.messages[4].tool_calls![0].function.arguments).code,code)
  assert.equal(messages[1].content,text)
})
