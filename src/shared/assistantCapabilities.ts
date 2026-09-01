/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { Assistant, SkillConfig, ToolConfig } from './types'

export function resolveAssistantSkills(assistant: Assistant, skills: SkillConfig[]): SkillConfig[] {
  const selected = new Set(assistant.skillIds ?? [])
  return skills.filter((skill) => skill.status === 'active' && selected.has(skill.id))
}

export function resolveAssistantTools(assistant: Assistant, tools: ToolConfig[]): ToolConfig[] {
  const selected = new Set(assistant.toolIds ?? [])
  return tools.filter((tool) => tool.enabled && selected.has(tool.id))
}

export function buildAssistantSkillContext(skills: SkillConfig[]): string {
  const activeSkills = skills.filter((skill) => skill.status === 'active' && skill.instructions.trim()).slice(0, 20)
  if (activeSkills.length === 0) return ''
  return `\n\n[当前助手已绑定的 Skill]\n这些 Skill 是工作区维护的可复用业务规则。与用户最新明确指令冲突时，以用户指令为准。\n${activeSkills
    .map((skill, index) => `${index + 1}. ${skill.name} (v${skill.version})\n${skill.instructions}`)
    .join('\n\n')}`
}
