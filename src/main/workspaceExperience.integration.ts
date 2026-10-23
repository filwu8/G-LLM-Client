/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { Conversation, WorkspaceAgentRequest } from '../shared/types'

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

  let scenario = 'document', step = 0
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    assert.equal(request.stream, true)
    const call = (name: string, args: unknown) => ({ role: 'assistant', tool_calls: [{ index: 0, id: `${scenario}-${step}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
    let delta: Record<string, unknown>
    if (scenario === 'document') {
      delta = step === 0 ? call('read_document', { path: imported[0].workspaceRelativePath })
        : step === 1 ? call('create_directory', { path: 'outputs' })
        : step === 2 ? call('create_docx', { output: 'outputs/review.docx', title: '合同审阅', content: '合同审阅\n供货方：甲公司\n采购方：乙公司\n交付期限：30 天\n付款期限：验收后 15 天\n建议明确验收标准。' })
        : { role: 'assistant', content: '已读取采购合同，审阅稿已保存：[审阅稿](outputs/review.docx)' }
      if (step === 1) assert.match(JSON.stringify(request.messages), /30 天/)
    } else if (scenario === 'settings') {
      delta = step === 0 ? call('update_application_settings', { settings: { theme: 'dark' } }) : { role: 'assistant', content: '软件主题已保存为深色。' }
    } else {
      delta = step === 0 ? call('update_application_settings', { settings: { theme: 'light' } }) : { role: 'assistant', content: '你拒绝了修改，设置保持原样。' }
    }
    step++
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>(fulfil => server.listen(0, '127.0.0.1', fulfil))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const provider = { ...storage.getProviders()[0], apiBaseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-only', defaultModel: 'fixture-model' }
  const request = (content: string): WorkspaceAgentRequest => ({ conversationId: 'contract-a', assistant, workspace: { ...workspace, approvalMode: 'full' }, provider,
    settings: { ...storage.getSettings(), language: 'zh-CN', webSearchMode: 'off' }, messages: [{ id: 'user', role: 'user', content, attachments: imported, createdAt: now }], webSearchMode: 'off', webSearchEnabled: false })
  try {
    const document = await runWorkspaceAgent(request('请读取采购合同并生成 Word 审阅稿 outputs/review.docx'), undefined, async () => true)
    assert.equal(document.plan.status, 'succeeded', JSON.stringify({ plan: document.plan, activities: document.activities }))
    assert.ok(document.changedFiles.some(file => file.replace(/\\/g, '/') === 'outputs/review.docx'))
    const report = await attachments.prepareWorkspaceFileAttachment(workspace.rootPath, 'outputs/review.docx')
    assert.match(report.text!, /验收标准/)
    scenario = 'settings'; step = 0
    let approvals = 0
    await runWorkspaceAgent(request('修改软件主题为深色'), undefined, async approval => {
      approvals++; assert.equal(approval.tool, 'update_application_settings'); assert.match(approval.preview!, /主题|theme/); return true
    })
    assert.equal(approvals, 1, 'configuration must require approval even in full mode')
    assert.equal(storage.getSettings().theme, 'dark')
    scenario = 'denied'; step = 0
    await runWorkspaceAgent(request('设置软件主题为浅色'), undefined, async () => false)
    assert.equal(storage.getSettings().theme, 'dark', 'denial must prevent setting changes')
  } finally { await new Promise<void>(fulfil => server.close(() => fulfil())) }

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
  console.log('Workspace experience passed: project folders, shared chats, durable originals, document read/create, live settings, mandatory approval, denial, stale preview protection and bound skills. No external provider or user data used.')
}
main().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
