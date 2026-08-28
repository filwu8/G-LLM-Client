/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

const workspaceActionPattern = /压缩|生成|创建|新建|修改|改成|替换|重命名|移动|整理|处理|转换|合并|拆分|写入|保存|编写|实现|修复|批量|开发|制作|做成|构建|搭建|打包|部署|compress|generate|create|modify|replace|rename|move|organize|process|convert|merge|split|write|save|implement|fix|batch|develop|build|package|deploy/i

export interface WorkspaceModelOutcome {
  content?: string | null
  toolCallCount: number
  reasoningCharacters?: number
  finishReason?: string | null
}

export interface WorkspaceMaxTokenSettings {
  enableMaxTokens: boolean
  maxTokens: number
}

export function isWorkspaceActionRequest(request: string): boolean {
  return workspaceActionPattern.test(request)
}

export function isReasoningOnlyLengthOutcome(outcome: WorkspaceModelOutcome): boolean {
  return outcome.finishReason === 'length' &&
    (outcome.reasoningCharacters ?? 0) > 0 &&
    outcome.toolCallCount === 0 &&
    !(outcome.content?.trim())
}

export function getWorkspaceMaxTokenOption(settings: WorkspaceMaxTokenSettings): { max_tokens?: number } {
  if (!settings.enableMaxTokens || !Number.isFinite(settings.maxTokens)) return {}
  return { max_tokens: Math.max(1, Math.floor(settings.maxTokens)) }
}

export function getReasoningLengthRecoveryPrompt(model: string, actionRequested: boolean): string {
  const noThink = /qwen/i.test(model) ? '/no_think\n' : ''
  const nextAction = actionRequested
    ? '用户要求实际开发或修改工作区。不要复述计划；立即调用一个最直接的工具开始执行，把任务拆成小步骤，每轮只完成一个清晰动作。'
    : '不要继续展开分析；立即给出简洁、完整的最终答复。'
  return `${noThink}上一轮推理过长并达到输出上限，没有产生正文或工具调用。${nextAction}`
}
