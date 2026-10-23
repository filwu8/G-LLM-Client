/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { usesWorkspaceAgent, relocateWorkspaceLocation, projectWorkspace } from './workspaceRouting.ts'
import type { ConversationWorkspace, ChatMessage } from './types'

const workspace: ConversationWorkspace = { rootPath: '/app/data/agent-workspaces/one', displayName: 'Workspace', kind: 'managed', permission: 'read-write', grantedAt: 0, lastVerifiedAt: 0 }
const message = (content: string): ChatMessage => ({ id: 'one', role: 'user', content, createdAt: 1 })
test('automatic workspace allocation preserves regular Q&A while file tasks use Agent tools', () => {
  for (const content of ['你好', '5%的年收益，20年后的收益多少？', '帮我写一句生日祝福', 'Generate an image of a cat', '如何创建 PDF 文件？', '你有哪些生成文件的能力', 'Explain how to create a report']) assert.equal(usesWorkspaceAgent({ workspace, messages: [message(content)] }), false, content)
  for (const content of ['帮我生成一个 Word 报告', '把报告保存为 PDF', '读取工作区的文件', 'Create a spreadsheet', '请修改这个项目代码']) assert.equal(usesWorkspaceAgent({ workspace, messages: [message(content)] }), true, content)
  assert.equal(usesWorkspaceAgent({ workspace: { ...workspace, browserAccess: true }, messages: [message('打开网页')] }), true)
  assert.equal(usesWorkspaceAgent({ workspace: { ...workspace, kind: 'external' }, messages: [message('你好')] }), true)
  assert.equal(usesWorkspaceAgent({ workspace, messages: [{ ...message('Produced'), workspaceChangedFiles: ['report.pdf'] }, message('继续修改')] }), true)
  assert.equal(usesWorkspaceAgent({ workspace, messages: [{ ...message('请审阅'), attachments: [{ id: 'contract', name: '合同.docx', size: 100, kind: 'file', mimeType: 'application/octet-stream', workspaceRelativePath: 'incoming/合同.docx' }] }] }), true)
  assert.equal(usesWorkspaceAgent({ workspace, messages: [message('把软件主题改成深色')] }), true)
  assert.equal(usesWorkspaceAgent({ workspace, messages: [message('如何修改软件配置？')] }), false)
  const project = projectWorkspace({ id: 'project', name: 'Contracts', workspacePath: '/contracts', createdAt: 1, updatedAt: 2 })!
  assert.equal(project.rootPath, '/contracts')
  assert.equal(project.projectId, 'project')
  assert.equal(usesWorkspaceAgent({ workspace: { ...project, kind: 'managed' }, messages: [message('审阅')] }), true)
})
test('open window draft paths follow relocation without rewriting external folders', () => {
  assert.equal(relocateWorkspaceLocation('C:\\Data\\agent-workspaces\\a', 'c:\\data', 'D:\\Moved', true), 'D:\\Moved\\agent-workspaces\\a')
  assert.equal(relocateWorkspaceLocation('C:\\Data-other\\a', 'C:\\Data', 'D:\\Moved', true), 'C:\\Data-other\\a')
  assert.equal(relocateWorkspaceLocation('/Data/a', '/data', '/new', false), '/Data/a')
})
