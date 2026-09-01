/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { Assistant, AssistantDelegationContext } from './types'

export interface DelegationDecision {
  target: Assistant
  nextContext: AssistantDelegationContext
}

export function removeAssistantDelegationReferences(
  assistants: Assistant[],
  removedAssistantId: string,
  projectId?: string
): Assistant[] {
  return assistants
    .filter((assistant) => !(assistant.id === removedAssistantId && assistant.projectId === projectId))
    .map((assistant) => assistant.projectId === projectId && assistant.delegateAssistantIds?.includes(removedAssistantId)
      ? {
          ...assistant,
          delegateAssistantIds: assistant.delegateAssistantIds.filter((id) => id !== removedAssistantId)
        }
      : assistant)
}

export function filterAvailableAssistantDelegations(assistants: Assistant[]): Assistant[] {
  const availableIds = new Set(assistants.map((assistant) => assistant.id))
  return assistants.map((assistant) => ({
    ...assistant,
    delegateAssistantIds: (assistant.delegateAssistantIds ?? []).filter((id) => id !== assistant.id && availableIds.has(id))
  }))
}

export function createDelegationContext(assistantId: string): AssistantDelegationContext {
  return { path: [assistantId], depth: 0, maxDepth: 2, remainingCalls: 4 }
}

export function authorizeAssistantDelegation(
  source: Assistant,
  targetId: string,
  assistants: Assistant[],
  context: AssistantDelegationContext = createDelegationContext(source.id)
): DelegationDecision {
  if (!(source.delegateAssistantIds ?? []).includes(targetId)) throw new Error('当前助手未获授权调用该助手')
  const target = assistants.find((assistant) => assistant.id === targetId && (assistant.status ?? 'active') === 'active')
  if (!target) throw new Error('目标助手不存在或已暂停')
  if (context.remainingCalls <= 0) throw new Error('助手协作已达到本轮调用次数上限')
  if (context.depth >= context.maxDepth) throw new Error('助手协作已达到最大调用深度')
  if (context.path.includes(target.id)) throw new Error('检测到助手循环调用，已停止协作')
  return {
    target,
    nextContext: {
      ...context,
      path: [...context.path, target.id],
      depth: context.depth + 1,
      remainingCalls: context.remainingCalls - 1
    }
  }
}
