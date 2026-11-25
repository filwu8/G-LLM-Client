/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Conversation, WorkspaceAgentRequest, WorkspaceInteractionRequest } from '../shared/types'
import { WorkspaceCheckpointStore, workspaceTaskId } from './workspaceCheckpoint'

const fixture = process.argv[2]
for (const folder of ['profile', 'app-data']) mkdirSync(join(fixture, folder))
app.setPath('userData', join(fixture, 'profile')); app.setPath('appData', join(fixture, 'app-data'))

async function main() {
  await app.whenReady()
  const storage = await import('./storage')
  const attachments = await import('./attachments')
  const { createDocxDocument } = await import('./docxDocument')
  const { runWorkspaceAgent } = await import('./workspaceAgent')
  const configuration = await import('./applicationConfiguration')
  const { listWorkspaceFiles } = await import('./workspaceFiles')
  const now = Date.now()
  const project = storage.saveProject({ id: 'contract-project', name: '合同项目', createdAt: now, updatedAt: now })
  assert.ok(project.workspacePath)
  const workspace = storage.ensureConversationWorkspace('contract-a', project.id)
  assert.equal(workspace.rootPath, project.workspacePath)
  assert.equal(workspace.projectId, project.id)
  const assistant = storage.getAssistants(project.id)[0]
  const makeConversation = (id: string): Conversation => ({ id, projectId: project.id, assistantId: assistant.id, title: id, workspace, createdAt: now, updatedAt: now, messages: [] })
  storage.saveConversation(makeConversation('contract-a'))
  storage.saveConversation(makeConversation('contract-b'))
  assert.equal(storage.getConversations(project.id).length, 2, 'multiple chats may share the project folder')
  const revoked = storage.saveConversation({ ...makeConversation('revoked'), messages: [{ id: 'one', role: 'user', content: 'hello', createdAt: now }], workspace: { ...workspace, computerAccess: true, browserAccess: true } })
  const unbound = storage.saveConversation({ ...revoked, workspace: undefined })
  assert.equal(unbound.workspace?.computerAccess, false)
  assert.equal(unbound.workspace?.browserAccess, false)
  const original = await createDocxDocument('采购合同', '采购合同\n供货方：甲公司\n采购方：乙公司\n交付期限：30 天\n付款期限：验收后 15 天', 'Fixture')
  const prepared = await attachments.preparePastedAttachments([{ name: '采购合同.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: original.buffer.length, kind: 'file', dataUrl: `data:application/octet-stream;base64,${original.buffer.toString('base64')}` }])
  const imported = await attachments.prepareWorkspaceAttachments(workspace.rootPath, prepared)
  assert.ok(imported[0].workspaceRelativePath)
  assert.deepEqual(await readFile(join(workspace.rootPath, imported[0].workspaceRelativePath!)), original.buffer)
  const savedConversation = storage.saveConversation({ ...makeConversation('contract-a'), messages: [{ id: 'attachment-user', role: 'user', content: '审阅合同', attachments: imported, createdAt: now }] })
  assert.equal(savedConversation.messages[0].attachments?.[0].workspaceRelativePath, imported[0].workspaceRelativePath)
  const persisted = await attachments.prepareWorkspaceFileAttachment(workspace.rootPath, imported[0].workspaceRelativePath!)
  assert.match(persisted.text!, /30 天/)
  assert.equal((await listWorkspaceFiles(workspace.rootPath, 'incoming')).entries[0].name, '采购合同.docx')
  const sections = 48
  await writeFile(join(workspace.rootPath, 'source.txt'), Array.from({ length: sections }, (_, index) => `section-${index}\n`.padEnd(256, 'x')).join(''))

  let scenario = 'document', step = 0
  let compactions = 0
  let overflowRejected = false
  let reconnectHits = 0
  let interruptedModelRequestId: string | string[] | undefined
  let interruptedAttemptId: string | string[] | undefined
  // The handler below is not awaited by the HTTP server, so an assertion thrown
  // inside it becomes an unhandled rejection instead of a test failure — the
  // suite would report success while the mock checks nothing. Collect them and
  // fail the run explicitly.
  const fixtureFailures: unknown[] = []
  process.on('unhandledRejection', (reason) => { fixtureFailures.push(reason) })
  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body = ''; for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    assert.equal(request.stream, true)
    const checkpointRequest = typeof request.messages.at(-1).content === 'string' && request.messages.at(-1).content.startsWith('[客户端进度检查]')
    if (scenario === 'overflow' && step === 1 && !overflowRejected) {
      overflowRejected = true
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'The maximum context length was exceeded' } }))
      return
    }
    if (scenario === 'recover' && step === 1 && !interruptedModelRequestId) {
      interruptedModelRequestId = req.headers['x-g-llm-request-id']
      interruptedAttemptId = req.headers['x-g-llm-attempt-id']
      res.writeHead(503)
      res.end('Temporary fixture failure')
      return
    }
    if (scenario === 'fallback' && request.tools) {
      res.writeHead(400)
      res.end('Native tools are not supported')
      return
    }
    const call = (name: string, args: unknown) => ({ role: 'assistant', tool_calls: [{ index: 0, id: `${scenario}-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    const verdict = (verification: string, final: string, workspaceStatus = 'completed') => ({ role: 'assistant', content: JSON.stringify({ workspaceStatus, verification, final }) })
    let delta: Record<string, unknown>
    if (scenario === 'document') {
      delta = step === 0 ? call('read_document', { path: imported[0].workspaceRelativePath })
        : step === 1 ? call('create_directory', { path: 'outputs' })
        : step === 2 ? call('create_docx', { output: 'outputs/review.docx', title: '合同审阅', content: '合同审阅\n供货方：甲公司\n采购方：乙公司\n交付期限：30 天\n付款期限：验收后 15 天\n建议明确验收标准。' })
        : step === 3 ? verdict('已生成审阅稿', '已完成')
        : step === 4 ? call('create_docx', { output: 'outputs/checklist.docx', title: '验收清单', content: '核对交付数量和日期。' })
        : verdict('审阅稿和验收清单均已生成。', '已交付审阅稿和验收清单。')
      if (step === 1) assert.match(JSON.stringify(request.messages), /30 天/)
      if (step === 4) assert.match(request.messages.at(-1).content, /缺少 checklist\.docx/)
    } else if (scenario === 'long') {
      if (checkpointRequest) {
        assert.equal(request.tools, undefined)
        assert.match(JSON.stringify(request.messages), new RegExp(`section-${step - 1}`))
        compactions += 1
        delta = { role: 'assistant', content: JSON.stringify({ criteria: `检查并汇总全部 ${sections} 段`, verified: `已读取 ${step} 段`, remaining: `剩余 ${sections - step} 段`, next: `从偏移 ${step * 256} 继续` }) }
      } else {
        if (step > 0 && step % 14 === 0) {
          assert.match(JSON.stringify(request.messages), /客户端任务检查点/)
          assert.match(JSON.stringify(request.messages), new RegExp(`已读取 ${step} 段`))
          assert.ok(request.messages.filter((item: { role: string }) => item.role === 'tool').length <= 2)
        }
        if (step === sections + 1) assert.match(request.messages.at(-1).content, /客户端验收检查/)
        delta = step < sections ? call('read_file', { path: 'source.txt', offset: step * 256, maxCharacters: 256 })
          : step === sections ? { role: 'assistant', content: '已读取材料。' }
          : verdict(`已读取并汇总全部 ${sections} 段。`, '检查完毕。\n```text\nsection-47\n```')
      }
    } else if (scenario === 'overflow') {
      if (step === 1) {
        assert.ok(request.tools, 'a context error must not disable the native tool protocol')
        assert.equal(request.messages.filter((item: { role: string }) => item.role === 'tool').length, 0)
        assert.match(JSON.stringify(request.messages), /客户端任务检查点/)
      }
      delta = step === 0 ? call('read_file', { path: 'source.txt', maxCharacters: 256 })
        : verdict('已读取第一段内容。', '第一段已核对。')
    } else if (scenario === 'stall') {
      delta = call('inspect_file', { path: 'source.txt' })
    } else if (scenario === 'interrupted') {
      delta = call('write_file', { path: 'outputs/first.txt', content: '第一份交付物' })
    } else if (scenario === 'recover') {
      assert.match(JSON.stringify(request.messages), /客户端任务检查点.*outputs[/\\]+first\.txt/s)
      if (step === 1) {
        // A retried 503 is replayed by runWorkspaceModelAttempts: the logical
        // request id stays stable and only the attempt id rotates. That is the
        // observable proof of a fresh attempt, so assert on it. (The
        // "[客户端连接恢复]" note is injected only in continuous goal mode, which
        // this scenario does not exercise.)
        assert.equal(req.headers['x-g-llm-request-id'], interruptedModelRequestId)
        assert.notEqual(req.headers['x-g-llm-attempt-id'], interruptedAttemptId)
      }
      delta = step === 0 ? call('write_file', { path: 'outputs/second.txt', content: '第二份交付物' })
        : verdict('执行记录确认两份文件已经写入。', '已交付两份文件。')
    } else if (scenario === 'limit') {
      delta = step === 0 ? call('write_file', { path: 'outputs/goal-draft.txt', content: '尚待核对的草稿' })
        : call('inspect_file', { path: 'outputs/goal-draft.txt' })
    } else if (scenario === 'reconnect') {
      // A 503 is retried in place by runWorkspaceModelAttempts, so the
      // agent-level retry loop — the only place the reconnect note is injected —
      // is not reached until those in-place attempts are exhausted. Burning all
      // three is what makes this scenario exercise the note at all.
      reconnectHits += 1
      const noteCount = request.messages.filter((item: { content?: unknown }) =>
        typeof item.content === 'string' && item.content.includes('[客户端连接恢复]')).length
      if (reconnectHits <= 3) {
        // A 503 is retried in place by runWorkspaceModelAttempts (3 attempts), so
        // the agent-level retry loop — the only place this note is injected — is
        // not reached yet.
        assert.equal(noteCount, 0, `no note during in-place retries (hit ${reconnectHits})`)
        res.writeHead(503)
        res.end('Temporary fixture failure')
        return
      }
      // The fourth request is the agent-level retry: it carries exactly one note
      // telling the model to build on the work already done instead of redoing it.
      assert.equal(noteCount, 1, 'the reconnect note is injected once')
      if (reconnectHits === 4) {
        const writeCall = call('write_file', { path: 'outputs/reconnect.txt', content: '只写一次' })
        writeCall.tool_calls[0].id = `reconnect-${reconnectHits}`
        delta = writeCall
      } else {
        delta = verdict('连接恢复后写入完成。', '已交付 reconnect.txt。')
      }
    } else if (scenario === 'blocked') {
      // The model cannot finish without a parameter only the user owns. The
      // client must ask for it and then continue the same task, never end with
      // a dead "incomplete" result.
      if (step === 0) {
        assert.ok(!JSON.stringify(request.messages).includes('[用户回答]'), 'the question is asked before any answer exists')
        delta = { role: 'assistant', content: JSON.stringify({ workspaceStatus: 'blocked', verification: '申请书缺少申请人名称。', question: { title: '申请人', question: '申请书上的申请人全名是什么？', selection: 'text' }, final: '请提供申请人名称。' }) }
      } else if (step === 1) {
        assert.match(JSON.stringify(request.messages), /\[用户回答\][^"]*张伟/)
        delta = call('write_file', { path: 'outputs/application.txt', content: '申请人：张伟' })
      } else {
        delta = verdict('已按用户回答写入申请人名称。', '已生成申请书 outputs/application.txt。')
      }
    } else if (scenario === 'blocked-loop') {
      // The model keeps asking for the same parameter. The client must not
      // interrogate the user in a loop: one question, then a paused task.
      delta = { role: 'assistant', content: JSON.stringify({ workspaceStatus: 'blocked', verification: '缺少申请人名称。', question: '申请书上的申请人全名是什么？', final: '请提供申请人名称。' }) }
    } else if (scenario === 'freeform') {
      // The model explains its work in prose but never returns the required
      // workspaceStatus JSON; the failure must still surface that explanation.
      if (step > 0) assert.match(request.messages.at(-1).content, /没有被识别为有效的 workspaceStatus JSON/)
      delta = { role: 'assistant', content: '我已核对三个仓库，根仓库的 HEAD 尚未复核完成，需要一次只读检查。' }
    } else if (scenario === 'fallback') {
      delta = step === 0
        ? { role: 'assistant', content: JSON.stringify({ tool: 'inspect_file', arguments: { path: 'source.txt' } }) }
        : verdict('检查结果确认 source.txt 存在。', '已确认文件存在。')
    } else if (scenario === 'answer') {
      delta = { role: 'assistant', content: '4' }
    } else if (scenario === 'settings') {
      if (step === 1) assert.match(request.messages.at(-1).content, /执行记录尚未确认/)
      delta = step === 0 ? verdict('已保存设置。', '已完成。')
        : step === 1 ? call('update_application_settings', { settings: { theme: 'dark' } })
        : verdict('设置工具确认主题为深色。', '软件主题已保存为深色。')
    } else if (scenario === 'hook') {
      if (step === 0) {
        delta = call('write_file', { path: 'approval-rules.json', content: JSON.stringify([{ action: 'shell', resource: '*', effect: 'allow' }]) })
      } else {
        // The veto must reach the model as a tool result; otherwise it cannot
        // know the write was refused rather than lost.
        assert.match(request.messages.at(-1).content, /Blocked by tool hook permission-file-guard/)
        delta = verdict('写审批配置被客户端钩子拒绝。', '无法修改审批配置，需要你手工改。', 'blocked')
      }
    } else {
      delta = step === 0 ? call('update_application_settings', { settings: { theme: 'light' } }) : { role: 'assistant', content: '你拒绝了修改，设置保持原样。' }
    }
    if (!checkpointRequest) step++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })}\n\n`)
    res.end('data: [DONE]\n\n')
  }
  // An assertion thrown inside the handler used to leave the request unanswered
  // and the run hanging until the client gave up — minutes per failure. Answer
  // immediately so a broken expectation fails in seconds.
  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      fixtureFailures.push(error)
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'fixture assertion failed' } }))
    })
  })
  await new Promise<void>(fulfil => server.listen(0, '127.0.0.1', fulfil))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const provider = { ...storage.getProviders()[0], apiBaseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-only', defaultModel: 'fixture-model' }
  const request = (content: string): WorkspaceAgentRequest => ({ conversationId: 'contract-a', assistant, workspace: { ...workspace, approvalMode: 'full' }, provider,
    settings: { ...storage.getSettings(), language: 'zh-CN', webSearchMode: 'off' }, messages: [{ id: `user-${scenario}`, role: 'user', content, attachments: imported, createdAt: now }], webSearchMode: 'off', webSearchEnabled: false })
  try {
    scenario = 'freeform'; step = 0
    const freeform = await runWorkspaceAgent(request('核对三个仓库并报告结果'))
    // No interaction channel here, so the run stops -- but it stops as a paused
    // task carrying the model's own explanation, not a bare "incomplete" error.
    assert.equal(freeform.plan.status, 'waiting')
    assert.match(freeform.content, /根仓库的 HEAD 尚未复核完成/)
    assert.match(freeform.content, /任务暂停/)

    scenario = 'document'; step = 0
    const document = await runWorkspaceAgent(request('请读取采购合同并生成 Word 审阅稿“review.docx”和验收清单“checklist.docx”'), undefined, async () => ({ approved: true }))
    assert.equal(document.plan.status, 'succeeded', JSON.stringify({ plan: document.plan, activities: document.activities }))
    assert.deepEqual(document.changedFiles.map(file => file.replace(/\\/g, '/')).sort(), ['outputs/checklist.docx', 'outputs/review.docx'])
    assert.equal(step, 6, 'the first artifact and the premature completion claim must not end the task')
    const report = await attachments.prepareWorkspaceFileAttachment(workspace.rootPath, 'outputs/review.docx')
    assert.match(report.text!, /验收标准/)

    scenario = 'long'; step = 0
    const longRequest = { ...request(`检查项目文件夹里的 source.txt 并汇总全部 ${sections} 段`), goalId: 'long-goal' }
    storage.saveConversation({
      ...makeConversation(longRequest.conversationId), messages: longRequest.messages,
      goalTask: { id: longRequest.goalId, goal: longRequest.messages[0].content, acceptanceCriteria: '', status: 'running', runCount: 1, startedAt: now, lastRunStartedAt: now, updatedAt: now }
    })
    const long = await runWorkspaceAgent(longRequest)
    assert.equal(long.plan.status, 'succeeded')
    assert.match(long.plan.verification!, /全部 48 段/)
    assert.match(long.content, /section-47/)
    assert.equal(compactions, 3)
    assert.equal(long.activities.filter(activity => activity.tool === 'task_checkpoint').length, compactions)
    assert.equal(step, sections + 2, 'the task continues beyond the old 42-turn ceiling')
    const delivered = storage.saveWorkspaceAgentResult(longRequest, long, now, 'long-run')
    assert.equal(delivered?.goalTask?.status, 'completed')
    assert.equal(storage.getConversations(project.id).find(item => item.id === longRequest.conversationId)?.messages.at(-1)?.id, 'workspace_long-run')
    assert.equal(storage.saveWorkspaceAgentResult(longRequest, long, now, 'duplicate-run'), undefined, 'the host commits the terminal response once')

    scenario = 'overflow'; step = 0
    const overflow = await runWorkspaceAgent(request('检查 source.txt 的第一段'))
    assert.equal(overflow.plan.status, 'succeeded')
    assert.equal(overflow.activities.filter(activity => activity.tool === 'task_checkpoint').length, 1)
    assert.equal(step, 2)

    scenario = 'reconnect'; step = 0; reconnectHits = 0
    const reconnected = await runWorkspaceAgent(request('连接恢复后写入 reconnect.txt'))
    assert.equal(reconnected.plan.status, 'succeeded')
    assert.deepEqual(reconnected.changedFiles.map(file => file.replace(/\\/g, '/')), ['outputs/reconnect.txt'])
    assert.equal(reconnectHits, 5, 'three in-place attempts, one agent-level retry, then a normal turn')
    assert.equal(
      reconnected.activities.filter(activity => activity.tool === 'model_request_retry').length,
      2,
      'one retry notice for the in-place attempts and one for the reconnect'
    )

    scenario = 'stall'; step = 0
    const stalled = await runWorkspaceAgent(request('持续核对 source.txt 中的内容'))
    assert.equal(stalled.plan.status, 'waiting')
    assert.match(stalled.content, /多次尝试后仍无新进展/)
    assert.equal(step, 7)

    scenario = 'interrupted'; step = 0
    const interrupted = request('请写入两份文件 first.txt 和 second.txt')
    const stop = new AbortController()
    await assert.rejects(runWorkspaceAgent(interrupted, progress => {
      if (progress.activity.tool === 'write_file' && progress.activity.status === 'completed') stop.abort()
    }, undefined, stop.signal), /aborted/i)
    const checkpoints = new WorkspaceCheckpointStore(storage.getDataLocationInfo().activePath, interrupted.conversationId)
    const taskId = workspaceTaskId(interrupted.messages[0].id)
    // The agent records the checkpoint under realpath(root); comparing it with
    // the raw workspace path only works where tmpdir is not a symlink (it is one
    // on macOS: /var -> /private/var, and on CI Windows runners). Resolve ours too.
    const savedProgress = checkpoints.load(taskId, await realpath(workspace.rootPath))
    assert.ok(savedProgress)
    assert.deepEqual(savedProgress.changedFiles.map(file => file.replace(/\\/g, '/')), ['outputs/first.txt'])
    assert.equal(savedProgress.pendingTool, undefined)
    scenario = 'recover'; step = 0
    const recovered = await runWorkspaceAgent(interrupted)
    assert.equal(recovered.plan.status, 'succeeded')
    assert.deepEqual(recovered.changedFiles.map(file => file.replace(/\\/g, '/')), ['outputs/first.txt', 'outputs/second.txt'])
    assert.ok(interruptedModelRequestId, 'the provider outage was exercised')
    assert.equal(step, 2)

    checkpoints.save({ ...savedProgress, pendingTool: '写入文件' })
    const uncertain = await runWorkspaceAgent(interrupted)
    // A resumed run with an uncertain pending tool is told to verify first and
    // then continue; it no longer fails forever. The model checks real state
    // before redoing side effects and reaches a normal verdict.
    assert.equal(uncertain.plan.status, 'succeeded')
    assert.match(uncertain.content, /已交付两份文件/)
    assert.ok(step >= 2, 'the resumed run proceeds to a verdict')

    scenario = 'limit'; step = 0
    const limited = await runWorkspaceAgent({ ...request('编写草稿并核对所有要求'), executionLimits: { maxTurns: 3, maxDurationMs: 60_000 } })
    assert.equal(step, 3, 'explicit goal limits remain hard limits')
    assert.equal(limited.plan.status, 'waiting')
    assert.match(limited.content, /任务暂停.*轮数上限/s)
    assert.deepEqual(limited.changedFiles.map(file => file.replace(/\\/g, '/')), ['outputs/goal-draft.txt'])
    assert.equal(await readFile(join(workspace.rootPath, 'outputs/goal-draft.txt'), 'utf8'), '尚待核对的草稿')

    scenario = 'blocked'; step = 0
    const asked: WorkspaceInteractionRequest[] = []
    const blocked = await runWorkspaceAgent(request('请把申请书保存为 outputs/application.txt'), undefined, undefined, undefined, undefined, undefined, async (question) => {
      asked.push(question)
      return { id: question.id, selectedIds: [], customText: '张伟', cancelled: false, answeredAt: Date.now() }
    })
    // A missing parameter the user owns is a question, never a dead result.
    assert.equal(asked.length, 1, 'a blocked verdict must become exactly one question')
    assert.equal(asked[0].title, '申请人')
    assert.equal(asked[0].selection, 'text')
    assert.match(asked[0].description!, /申请人全名/)
    assert.equal(blocked.plan.status, 'succeeded', JSON.stringify({ plan: blocked.plan, activities: blocked.activities }))
    assert.equal(blocked.content, '已生成申请书 outputs/application.txt。')
    assert.equal(await readFile(join(workspace.rootPath, 'outputs/application.txt'), 'utf8'), '申请人：张伟')
    assert.ok(blocked.activities.some(activity => activity.tool === 'ask_user' && activity.status === 'completed'), 'the question is part of the visible run log')
    assert.equal(step, 3, 'the same task continues after the answer instead of restarting')

    scenario = 'blocked-loop'; step = 0
    let repeatedQuestions = 0
    const looped = await runWorkspaceAgent(request('请把申请书保存为 outputs/application.txt'), undefined, undefined, undefined, undefined, undefined, async (question) => {
      repeatedQuestions += 1
      return { id: question.id, selectedIds: [], customText: '还是不知道', cancelled: false, answeredAt: Date.now() }
    })
    // Answering an unanswerable question must not turn into an interrogation.
    assert.equal(repeatedQuestions, 1, 'the same question is never asked twice')
    assert.equal(looped.plan.status, 'waiting')
    assert.match(looped.content, /任务暂停/)

    scenario = 'fallback'; step = 0
    const fallback = await runWorkspaceAgent(request('检查项目文件夹中是否有 source.txt'))
    assert.equal(fallback.plan.status, 'succeeded')
    assert.equal(fallback.content, '已确认文件存在。')
    assert.ok(fallback.activities.some(activity => activity.tool === 'inspect_file' && activity.status === 'completed'))

    scenario = 'answer'; step = 0
    const question = request('2 加 2 等于多少？')
    question.messages[0].attachments = undefined
    const answer = await runWorkspaceAgent(question)
    assert.equal(answer.plan.status, 'succeeded')
    assert.equal(answer.content, '4')
    assert.equal(step, 1)

    scenario = 'settings'; step = 0
    let approvals = 0
    const settings = await runWorkspaceAgent(request('修改软件主题为深色'), undefined, async approval => {
      approvals++; assert.equal(approval.tool, 'update_application_settings'); assert.match(approval.preview!, /主题|theme/); return { approved: true }
    })
    assert.equal(settings.plan.status, 'succeeded')
    assert.equal(step, 3)
    assert.equal(approvals, 1, 'configuration must require approval even in full mode')
    assert.equal(storage.getSettings().theme, 'dark')
    scenario = 'denied'; step = 0
    const denied = await runWorkspaceAgent(request('设置软件主题为浅色'), undefined, async () => ({ approved: false }))
    // A denial is the user's own decision, so the task pauses instead of failing.
    assert.equal(denied.plan.status, 'waiting')
    assert.equal(step, 1, 'an explicit denial must not be retried')
    assert.equal(storage.getSettings().theme, 'dark', 'denial must prevent setting changes')
    // A hook veto is decided before the prompt, so a refused call never spends
    // the user's click -- and the refusal still reaches the model as a result.
    scenario = 'hook'; step = 0
    let hookApprovals = 0
    const vetoed = await runWorkspaceAgent(request('把审批规则改成全部允许'), undefined, async () => { hookApprovals++; return { approved: true } })
    assert.equal(hookApprovals, 0, 'a hook veto must be decided before asking the user')
    assert.equal(vetoed.plan.status, 'waiting')
    assert.match(vetoed.content, /无法修改审批配置/)
    await assert.rejects(readFile(join(workspace.rootPath, 'approval-rules.json')), 'a vetoed write must not reach disk')
  } finally { await new Promise<void>(fulfil => server.close(() => fulfil())) }
  // Surface any assertion the mock handler threw. Without this the run reports
  // success while the fixture silently verified nothing.
  assert.deepEqual(fixtureFailures, [], 'mock server assertions must hold')

  const stale = configuration.prepareApplicationChange(request('change settings'), 'update_application_settings', { settings: { theme: 'light' } })
  storage.setSettings({ ...storage.getSettings(), theme: 'auto' })
  assert.throws(() => stale.commit(), /changed while/)
  assert.throws(() => configuration.prepareApplicationChange(request('change settings'), 'update_application_settings', { settings: { apiKey: 'never-save-this' } }))
  const skill = configuration.prepareApplicationChange(request('创建合同审阅技能'), 'configure_assistant_skill', { name: '合同审阅', instructions: '读取原始合同，列出条款原文、问题和修改建议；未知信息标记待确认。' })
  const receipt = skill.commit(); assert.equal(receipt.saved, true)
  assert.ok(storage.getAssistants(project.id).find(item => item.id === assistant.id)?.skillIds?.length)
  const installed = storage.getSkills(project.id).find(item => item.name === '合同审阅')!
  assert.equal(configuration.getApplicationConfiguration(request('读取技能说明'), installed.id).skill?.instructions, installed.instructions)
  configuration.prepareApplicationChange(request('更新技能'), 'configure_assistant_skill', { skillId: installed.id, name: installed.name, instructions: '读取合同原件，列出风险并生成可编辑审阅稿。' }).commit()
  const revised = storage.getSkills(project.id).find(item => item.id === installed.id)!
  assert.equal(revised.revisions?.at(-1)?.instructions, installed.instructions)
  assert.notEqual(revised.version, installed.version)
  assert.equal(JSON.stringify(configuration.getApplicationConfiguration(request('settings'))).includes('apiKey'), false)
  // Binding an external folder must use it directly, without moving its files.
  const external = join(fixture, 'existing-project'); mkdirSync(external)
  await writeFile(join(external, 'keep.txt'), 'original')
  const externalProject = storage.saveProject({ id: 'external-project', name: 'Existing folder', workspacePath: external, createdAt: now, updatedAt: now })
  assert.equal(storage.ensureConversationWorkspace('external-chat', externalProject.id).rootPath, external)
  assert.equal(await readFile(join(external, 'keep.txt'), 'utf8'), 'original')
  console.log('Workspace experience passed with fixture data, including long goals, host delivery, context overflow recovery, reconnect, durable resume and approval boundaries.')
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
