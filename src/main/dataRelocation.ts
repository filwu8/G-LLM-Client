/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Conversation, Project, SkillConfig } from '../shared/types'

export function relocateDataPath(path: string, previousRoot: string, nextRoot: string): string {
  if (!isAbsolute(path)) return path
  const activeDifference = relative(resolve(nextRoot), resolve(path))
  if (activeDifference !== '..' && !activeDifference.startsWith(`..${sep}`) && !isAbsolute(activeDifference)) return path
  const difference = relative(resolve(previousRoot), resolve(path))
  if (difference === '..' || difference.startsWith(`..${sep}`) || isAbsolute(difference)) return path
  return resolve(nextRoot, difference)
}

function relocateLink(link: string, previousRoot: string, nextRoot: string): string {
  if (link.startsWith('file:')) {
    try {
      const source = fileURLToPath(link), target = relocateDataPath(source, previousRoot, nextRoot)
      return source === target ? link : pathToFileURL(target).href
    } catch { return link }
  }
  return relocateDataPath(link, previousRoot, nextRoot)
}

export function relocateMarkdownLinks(content: string, previousRoot: string, nextRoot: string): string {
  // Update link destinations, never user prose, examples, credentials or audit text.
  return content.replace(/(\]\(\s*)(<[^>\r\n]+>|[^\s)]+)(?=[\s)])/g, (_match, prefix: string, destination: string) => {
    const angled = destination.startsWith('<')
    const target = relocateLink(angled ? destination.slice(1, -1) : destination, previousRoot, nextRoot)
    return prefix + (angled ? `<${target}>` : target)
  })
}

export function relocateConversation(conversation: Conversation, previousRoot: string, nextRoot: string): Conversation {
  return {
    ...conversation,
    workspace: conversation.workspace ? { ...conversation.workspace, rootPath: relocateDataPath(conversation.workspace.rootPath, previousRoot, nextRoot) } : undefined,
    messages: conversation.messages.map(message => ({
      ...message,
      content: relocateMarkdownLinks(message.content, previousRoot, nextRoot),
      workspaceArtifactRoot: message.workspaceArtifactRoot ? relocateDataPath(message.workspaceArtifactRoot, previousRoot, nextRoot) : undefined,
      attachments: message.attachments?.map(attachment => ({ ...attachment,
        workspaceRootPath: attachment.workspaceRootPath ? relocateDataPath(attachment.workspaceRootPath, previousRoot, nextRoot) : undefined,
        dataUrl: attachment.dataUrl?.startsWith('file:') ? relocateLink(attachment.dataUrl, previousRoot, nextRoot) : attachment.dataUrl }))
    }))
  }
}

export function relocateStoredData<T extends { conversations: Conversation[]; projects: Project[]; skills: SkillConfig[]; notes?: Array<{ content: string }>; dataRootAliases?: string[] }>(data: T, previousRoot: string, nextRoot: string): T {
  return {
    ...data,
    dataRootAliases: [...new Set([...(data.dataRootAliases ?? []), previousRoot])].filter(root => resolve(root) !== resolve(nextRoot)),
    conversations: data.conversations.map(conversation => relocateConversation(conversation, previousRoot, nextRoot)),
    projects: data.projects.map(project => ({ ...project, workspacePath: project.workspacePath ? relocateDataPath(project.workspacePath, previousRoot, nextRoot) : undefined })),
    skills: data.skills.map(skill => ({ ...skill, sourceLocator: skill.sourceLocator ? relocateLink(skill.sourceLocator, previousRoot, nextRoot) : skill.sourceLocator })),
    ...(data.notes ? { notes: data.notes.map(note => ({ ...note, content: relocateMarkdownLinks(note.content, previousRoot, nextRoot) })) } : {})
  }
}
