/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

const workspaceActionPattern = /压缩|生成|创建|新建|修改|改成|替换|重命名|移动|整理|处理|转换|合并|拆分|写入|保存|编写|实现|修复|批量|开发|制作|做成|构建|搭建|打包|部署|compress|generate|create|modify|replace|rename|move|organize|process|convert|merge|split|write|save|implement|fix|batch|develop|build|package|deploy/i
const workspaceArtifactRequestPattern = /(?:帮我|请(?:你)?|替我|为我|我需要(?:你)?|我想让你|需要你|please\s+(?:help me\s+)?|can you\s+|could you\s+|i need you to\s+|i want you to\s+)(?=[^。！？!?\n]{0,96}(?:形成|起草|撰写|编制|整理成|汇总成|生成|创建|制作|填写|编写|写|导出|保存为|交付|draft|write|prepare|compile|create|generate|produce|fill in|export|save|deliver))[^。！？!?\n]{0,96}(?:形成|起草|撰写|编制|整理成|汇总成|生成|创建|制作|填写|编写|写|导出|保存为|交付|draft|write|prepare|compile|create|generate|produce|fill in|export|save|deliver)[^。！？!?\n]{0,80}(?:申报材料|申报书|申请材料|申请书|材料|报告|方案|文档|文件|表格|表单|简历|说明书|\.(?:docx?|pdf|xlsx?|pptx?|md|txt|csv)|application|proposal|report|document|spreadsheet|form|resume|file)/i
const imageGenerationActionPattern = /生成|画|绘制|制作|设计|create|generate|draw|paint|design/i
const imageGenerationSubjectPattern = /图片|图像|插画|海报|封面|壁纸|头像|logo|标志|照片|效果图|配图|image|illustration|poster|cover|wallpaper|avatar|photo|picture|artwork/i
const explicitDrawingRequestPattern = /(?:帮我|请|给我)?(?:画|绘制)(?:一|个|张|幅|出)|\b(?:draw|paint)\s+(?:me\s+)?(?:a|an|the)\b/i
const imageGenerationCommandPattern = /(?:帮我|请|给我|我要|我想要|需要|重新|再)(?:再|重新)?(?:帮我|为我)?(?:生成|画|绘制|制作|设计)|(?:生成|画|绘制|制作|设计)(?:一|个|张|幅|出|这|该)|(?:^|[。！？!?，,；;]\s*)(?:生成|画|绘制|制作|设计)(?!的|了|过)(?:[^。！？!?\n]{0,24})(?:图片|图像|插画|海报|封面|壁纸|头像|logo|标志|照片|效果图|配图)|\b(?:please\s+|can\s+you\s+|i\s+(?:want|need)\s+you\s+to\s+|re-?|again\s+)?(?:create|generate|draw|paint|design)\s+(?:me\s+)?(?:a|an|the|this)\b/i
const imageGenerationNegationPattern = /(?:不要|无需|不用|别|不需要)(?:[^。！？!?\n]{0,12})?(?:生成|画|绘制|制作|设计)|\b(?:do\s+not|don't|no\s+need\s+to|without)\s+(?:create|generate|draw|paint|design)\b/i

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

/** True when the user explicitly asks for a file/document-like deliverable. */
export function isWorkspaceArtifactRequest(request: string): boolean {
  const isExplicitRequest = workspaceArtifactRequestPattern.test(request)
  return isExplicitRequest || /^(?:create|draft|write|prepare|compile|generate|produce|export|save|deliver)\b[^\n]{0,100}(?:application|proposal|report|document|spreadsheet|form|resume|file|\.(?:docx?|pdf|xlsx?|pptx?|md|txt|csv))/i.test(request.trim())
}

export function isImageGenerationRequest(request: string): boolean {
  if (imageGenerationNegationPattern.test(request)) return false
  return explicitDrawingRequestPattern.test(request) || (
    imageGenerationActionPattern.test(request) &&
    imageGenerationSubjectPattern.test(request) &&
    imageGenerationCommandPattern.test(request)
  )
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

/** Report the observed tool failure instead of diagnosing the model from a missing artifact. */
export function getWorkspaceFileFailureMessage(fallback: string, activities: Array<{ tool: string; status: string; detail?: string }>): string {
  const failure = activities.slice().reverse().find((activity) => activity.status === 'failed' && activity.detail?.trim())
  return failure ? `${fallback}\n${failure.tool}: ${failure.detail!.trim().slice(0, 1200)}` : fallback
}
