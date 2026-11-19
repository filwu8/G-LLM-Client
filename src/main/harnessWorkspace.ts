/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { configureHarnessEnvironment, HarnessBridge, inspectHarnessRuntime, setHarnessRuntimeOverride, type HarnessApprovalOutcome } from './workspaceHarness.ts'
import { createWorkspacePlan, finishPlan } from '../shared/agentPlanning.ts'
import type {
  ApiProvider,
  ChatMessage,
  WorkspaceAgentProgress,
  WorkspaceAgentRequest,
  WorkspaceAgentResult,
  WorkspaceToolActivity
} from '../shared/types'
/** Configure the bridge's Electron paths once at module load (no-op in plain Node). */
function configureFromElectron(): void {
  try {
    // Lazy import keeps this module testable under plain `node --test`.
    if (!process.versions.electron) return
    const electron = createRequire(import.meta.url)('electron') as typeof import('electron')
    configureHarnessEnvironment({
      isPackaged: electron.app.isPackaged,
      appPath: electron.app.getAppPath(),
      resourcesPath: process.resourcesPath
    })
  } catch {
    // Running outside Electron: callers/tests configure explicitly.
  }
}
configureFromElectron()

function textOf(content: ChatMessage['content']): string {
  return typeof content === 'string' ? content : ''
}

/** Turn the recent conversation into one self-contained prompt for Harness. */
export function buildHarnessPrompt(messages: ChatMessage[], goal?: string): string {
  const history = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const role = message.role === 'user' ? '用户' : '助手'
      return `[${role}]\n${textOf(message.content)}`
    })
    .filter((block) => block.length > `[用户]\n`.length + 1)
  const recent = history.slice(-12).join('\n\n---\n\n')
  const instruction = goal?.trim()
    ? `请在工作区中完成以下任务：\n${goal.trim()}`
    : '请根据下面的对话上下文，继续在工作区中完成用户最近提出的代码/文件任务。'
  return `${instruction}\n\n工作区位于当前 process cwd。请直接读写文件、运行项目自带的检查命令来自我验证，最后用中文简要说明你做了什么、改了哪些文件、如何验证。\n\n<conversation>\n${recent}\n</conversation>`
}

export interface HarnessExecutionOptions {
  request: WorkspaceAgentRequest
  goal?: string
  sessionId?: string
  signal?: AbortSignal
  onProgress?: (progress: WorkspaceAgentProgress) => void
  onApproval?: (prompt: {
    id: string
    purpose: string
    tool?: string
    preview?: string
    canWrite: boolean
  }, signal?: AbortSignal) => Promise<boolean>
  onRuntimeEvent?: (event: { type: string; status: string; details?: Record<string, unknown> }) => void
  runId?: string
}

function activity(id: string, tool: string, label: string, status: WorkspaceToolActivity['status'], detail?: string): WorkspaceToolActivity {
  return { id, tool, label, status, ...(detail ? { detail } : {}) }
}

/**
 * Execute a workspace task through the embedded DeepSeek Harness runtime.
 * Used by both the fully-delegated mode and the delegate_to_harness tool.
 */
export async function runHarnessWorkspace(options: HarnessExecutionOptions): Promise<{
  finalResponse: string
  sessionId: string
  finishReason: string | null
}> {
  const { request } = options
  const harnessConfig = request.workspace.harness ?? {}
  if (harnessConfig.runtimePath) setHarnessRuntimeOverride(harnessConfig.runtimePath)
  else setHarnessRuntimeOverride(undefined)

  const runtime = inspectHarnessRuntime()
  if (!runtime.available) {
    throw new Error(`DeepSeek Harness 运行时不可用：${runtime.reason || '未安装'}`)
  }
  const onRuntimeEvent = options.onRuntimeEvent
  const onProgress = options.onProgress
  const progress = (tool: string, label: string, status: WorkspaceToolActivity['status'], detail?: string) => {
    onProgress?.({
      conversationId: request.conversationId,
      activity: activity(`${options.runId || 'harness'}-${tool}`, tool, label, status, detail)
    })
  }
  onRuntimeEvent?.({ type: 'harness_start', status: 'running_tool', details: { runtimeDir: runtime.runtimeDir } })

  const dshHome = `${request.workspace.rootPath}/.dsh-home`.replace(/\\/g, '/')
  const bridge = new HarnessBridge({
    onNotification: (notification) => {
      const method = String(notification.method || '')
      if (!method) return
      onRuntimeEvent?.({ type: `harness_${method}`, status: 'running_tool' })
    },
    onApprovalRequest: (approval) => {
      // Fire-and-forget: the bridge awaits our answer; the host UI decides.
      void (async () => {
        const approved = options.onApproval
          ? await options.onApproval({
              id: approval.callId,
              purpose: String(approval.toolName ? `Harness 请求执行 ${approval.toolName}` : 'Harness 工具审批'),
              tool: approval.toolName,
              preview: approval.reason,
              canWrite: request.workspace.permission === 'read-write'
            }, options.signal)
          : request.workspace.approvalMode === 'full'
        const outcome: HarnessApprovalOutcome = approved ? 'allowed-once' : 'rejected'
        try { await bridge.answerApproval(approval.callId, outcome) } catch { /* bridge may be closing */ }
      })()
    },
    onLog: (level, message) => {
      if (level === 'error') onRuntimeEvent?.({ type: 'harness_stderr', status: 'failed', details: { message } })
    }
  })

  progress('harness_init', '启动 DeepSeek Harness 引擎', 'running')
  try {
    options.signal?.throwIfAborted()
    const provider: ApiProvider = request.provider
    // Route by provider template so any OpenAI-compatible gateway (G-LLM,
    // OpenAI, Gemini, DashScope, custom) works, not just DeepSeek. The bridge
    // maps template ids to the right dsh adapter and credential env var.
    const route = harnessConfig.provider || provider.templateId || 'gllm'
    const model = harnessConfig.model || provider.defaultModel || provider.models?.[0]?.id || ''
    await bridge.init({
      provider: route,
      model,
      apiKey: provider.apiKey || '',
      baseUrl: provider.apiBaseUrl || '',
      cwd: request.workspace.rootPath,
      dshHome,
      profile: harnessConfig.profile || 'sdk-minimal',
      approvalRequests: true,
      maxTokens: request.settings.enableMaxTokens ? request.settings.maxTokens : undefined
    })
    progress('harness_init', '启动 DeepSeek Harness 引擎', 'completed')

    const prompt = buildHarnessPrompt(request.messages, options.goal)
    progress('harness_run', 'Harness 正在执行任务', 'running')
    const result = await bridge.run(prompt, options.sessionId)
    progress('harness_run', 'Harness 正在执行任务', 'completed', `finishReason=${result.finishReason ?? 'unknown'}`)
    onRuntimeEvent?.({ type: 'harness_complete', status: 'completed', details: { finishReason: result.finishReason } })
    return { finalResponse: result.finalResponse, sessionId: result.sessionId, finishReason: result.finishReason }
  } catch (error) {
    progress('harness_run', 'Harness 正在执行任务', 'failed', error instanceof Error ? error.message : String(error))
    onRuntimeEvent?.({ type: 'harness_failed', status: 'failed', details: { message: error instanceof Error ? error.message : String(error) } })
    throw error
  } finally {
    try { await bridge.close() } catch { /* best effort */ }
  }
}

/** Wrap a Harness result into the standard WorkspaceAgentResult shape. */
export function toWorkspaceAgentResult(request: WorkspaceAgentRequest, finalResponse: string, startedAt: number): WorkspaceAgentResult {
  const goal = request.messages.map((message) => textOf(message.content)).reverse().find(Boolean) || '工作区任务'
  let plan = createWorkspacePlan(goal, startedAt)
  plan = finishPlan(plan, 'succeeded', '由 DeepSeek Harness 引擎执行并完成')
  return {
    conversationId: request.conversationId,
    content: finalResponse || 'DeepSeek Harness 未返回文本结果。',
    activities: [activity(randomUUID(), 'harness', 'DeepSeek Harness 引擎', 'completed')],
    changedFiles: [],
    plan
  }
}
