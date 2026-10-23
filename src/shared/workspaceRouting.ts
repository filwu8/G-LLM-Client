/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import type { Conversation, ConversationWorkspace, Project } from './types'

export function projectWorkspace(project?: Project | null): ConversationWorkspace | undefined {
  if (!project?.workspacePath) return undefined
  return { projectId: project.id, rootPath: project.workspacePath, displayName: project.name, kind: 'external',
    permission: 'read-write', approvalMode: 'ask', grantedAt: project.createdAt, lastVerifiedAt: project.updatedAt }
}

const fileSubject = /文件|目录|文件夹|工作区|项目|代码|仓库|文档|报告|表格|表单|简历|申报|幻灯片|演示文稿|网页|网站|(?:^|\W)(?:files?|folders?|directories|workspace|code|repository|document|report|spreadsheet|presentation|website|pdf|docx?|xlsx?|pptx?|html)(?:\W|$)|\.(?:pdf|docx?|xlsx?|pptx?|csv|md|txt|json|html?|css|[jt]sx?|py|sh|ps1)\b/i
const fileAction = /生成|创建|新建|制作|做|编写|写|起草|导出|保存|读取|查看|查找|搜索|分析|总结|处理|压缩|转换|修改|修复|替换|整理|开发|构建|打包|部署|生成|create|generate|make|draft|write|export|save|read|inspect|find|search|analy[sz]e|summari[sz]e|process|compress|convert|edit|modify|fix|replace|organi[sz]e|develop|build|package|deploy/i

export function usesWorkspaceAgent(conversation: Pick<Conversation, 'workspace' | 'messages'>): conversation is Pick<Conversation, 'messages'> & { workspace: ConversationWorkspace } {
  const workspace = conversation.workspace
  if (!workspace) return false
  if (workspace.projectId || workspace.kind !== 'managed' || workspace.nativeExecution || workspace.computerAccess || workspace.browserAccess) return true
  if (conversation.messages.findLast(message => message.role === 'user')?.attachments?.some(attachment => attachment.workspaceRelativePath)) return true
  const request = conversation.messages.findLast(message => message.role === 'user')?.content ?? ''
  const advice = /怎么|如何|为什么|什么是|有哪些|有什么|我想了解|介绍|解释|教程|\b(?:how (?:do|can|to)|what (?:is|are)|explain|tutorial)\b/i.test(request)
  const directTask = /帮我|替我|为我|我要|我需要|我想要|^(?:把|将)|\b(?:please (?:create|generate|write|build|make)|can you (?:please )?(?:create|generate|write|build|make))\b/i.test(request)
  if (advice && !directTask) return false
  if (/配置|设置|主题|界面|软件|客户端|技能|skill|setting|theme|configuration/i.test(request) && /改|设|调整|启用|关闭|安装|添加|创建|绑定|change|set|enable|disable|install|create|configure/i.test(request)) return true
  if (conversation.messages.some(message => (message.workspaceChangedFiles?.length ?? 0) > 0)) return true
  return fileSubject.test(request) && fileAction.test(request)
}

export function relocateWorkspaceLocation(path: string, previousRoot: string, nextRoot: string, windows: boolean): string {
  const normalized = path.replace(/\\/g, '/'), previous = previousRoot.replace(/\\/g, '/').replace(/\/+$/, ''), next = nextRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const compare = (value: string) => windows ? value.toLowerCase() : value
  if (compare(normalized) === compare(next) || compare(normalized).startsWith(`${compare(next)}/`)) return path
  if (compare(normalized) !== compare(previous) && !compare(normalized).startsWith(`${compare(previous)}/`)) return path
  return nextRoot.replace(/[\\/]+$/, '') + normalized.slice(previous.length).replace(/\//g, nextRoot.includes('\\') ? '\\' : '/')
}
