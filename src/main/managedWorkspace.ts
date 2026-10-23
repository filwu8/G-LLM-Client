/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ConversationWorkspace } from '../shared/types'

export function createManagedWorkspace(dataRoot: string, conversationId: string, displayName: string, now = Date.now()): ConversationWorkspace {
  if (!conversationId.trim() || conversationId.length > 256) throw new Error('Invalid conversation ID')
  const parent = join(dataRoot, 'agent-workspaces')
  const rootPath = join(parent, createHash('sha256').update(conversationId).digest('hex'))
  return ensureManagedWorkspace(parent, rootPath, displayName, now)
}

export function createProjectWorkspace(dataRoot: string, projectId: string, displayName: string): ConversationWorkspace {
  const name = displayName.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 60) || 'Workspace'
  const suffix = createHash('sha256').update(projectId).digest('hex').slice(0, 10)
  const parent = join(dataRoot, 'agent-workspaces')
  return ensureManagedWorkspace(parent, join(parent, `${name}-${suffix}`), displayName, Date.now())
}

function ensureManagedWorkspace(parent: string, rootPath: string, displayName: string, now: number): ConversationWorkspace {
  for (const directory of [parent, rootPath]) {
    if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Managed workspace cannot be a symbolic link')
    mkdirSync(directory, { recursive: true })
  }
  return { rootPath, displayName, kind: 'managed', permission: 'read-write', approvalMode: 'ask', nativeExecution: false, computerAccess: false, browserAccess: false, grantedAt: now, lastVerifiedAt: now }
}
