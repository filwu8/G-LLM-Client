/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type {
  Assistant,
  AssistantTemplateBundle,
  AssistantTemplateImportResult,
  SkillConfig,
  ToolConfig
} from './types'

export function createAssistantTemplateBundle(
  assistant: Assistant,
  allSkills: SkillConfig[],
  allTools: ToolConfig[],
  publisher?: string,
  now = Date.now()
): AssistantTemplateBundle {
  const skillIds = new Set(assistant.skillIds ?? [])
  const toolIds = new Set([
    ...(assistant.toolIds ?? []),
    ...allSkills.filter((skill) => skillIds.has(skill.id)).flatMap((skill) => skill.toolIds)
  ])
  return {
    schemaVersion: 1,
    exportedAt: now,
    publisher: publisher?.trim().slice(0, 120) || undefined,
    assistant: { ...assistant, projectId: undefined, delegateAssistantIds: [] },
    skills: allSkills.filter((skill) => skillIds.has(skill.id)).map((skill) => ({ ...skill, projectId: undefined })),
    tools: allTools.filter((tool) => toolIds.has(tool.id)).map((tool) => ({
      ...tool,
      projectId: undefined,
      endpoint: undefined,
      enabled: false
    }))
  }
}

export function importAssistantTemplateBundle(
  value: unknown,
  projectId: string,
  createId: (prefix: string) => string,
  now = Date.now()
): AssistantTemplateImportResult {
  if (!value || typeof value !== 'object') throw new Error('助手模板格式无效')
  const bundle = value as Partial<AssistantTemplateBundle>
  if (bundle.schemaVersion !== 1 || !bundle.assistant || !Array.isArray(bundle.skills) || !Array.isArray(bundle.tools)) {
    throw new Error('不支持的助手模板版本')
  }
  const toolIdMap = new Map(bundle.tools.map((tool) => [tool.id, createId('tool')]))
  const skillIdMap = new Map(bundle.skills.map((skill) => [skill.id, createId('skill')]))
  const tools = bundle.tools.map((tool) => ({
    ...tool,
    id: toolIdMap.get(tool.id)!,
    projectId,
    endpoint: undefined,
    enabled: false,
    createdAt: now,
    updatedAt: now
  }))
  const skills = bundle.skills.map((skill) => ({
    ...skill,
    id: skillIdMap.get(skill.id)!,
    projectId,
    sourceType: 'imported' as const,
    sourceLocator: bundle.publisher ? `publisher:${bundle.publisher}` : 'assistant-template',
    toolIds: skill.toolIds.map((id) => toolIdMap.get(id)).filter((id): id is string => Boolean(id)),
    createdAt: now,
    updatedAt: now
  }))
  const assistant: Assistant = {
    ...bundle.assistant,
    id: createId('assistant'),
    projectId,
    builtIn: false,
    hidden: false,
    status: 'draft',
    configSource: {
      type: 'imported',
      locator: bundle.publisher ? `publisher:${bundle.publisher}` : 'assistant-template',
      version: bundle.assistant.configSource?.version ?? '1.0.0'
    },
    skillIds: (bundle.assistant.skillIds ?? []).map((id) => skillIdMap.get(id)).filter((id): id is string => Boolean(id)),
    toolIds: (bundle.assistant.toolIds ?? []).map((id) => toolIdMap.get(id)).filter((id): id is string => Boolean(id)),
    delegateAssistantIds: [],
    createdAt: now,
    updatedAt: now
  }
  return {
    assistant,
    skills,
    tools,
    warnings: tools.length > 0 ? ['出于安全考虑，导入工具的地址已清除且默认停用，请检查后重新配置。'] : []
  }
}
