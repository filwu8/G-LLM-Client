/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { AppSettings, WorkspaceAgentRequest } from '../shared/types'
import { deleteSkill, getActiveProjectId, getAssistants, getSettings, getSkills, saveAssistant, saveSkill, setSettings } from './storage'
import { assistantSettingKeys, validateAssistantSettings } from './applicationConfigPolicy'
import { evolveSkill } from '../shared/skillLifecycle'
import { mainT } from './i18n'

export const applicationToolDefinitions = [
  { type: 'function' as const, function: { name: 'get_application_configuration', description: 'Read supported application settings and the current assistant’s skill bindings. Supply skillId to read an existing skill’s complete instructions before updating it. Never reads keys or credential values. MCP and plugin runtimes are not available.', parameters: { type: 'object', properties: { skillId: { type: 'string' } } } } },
  { type: 'function' as const, function: { name: 'update_application_settings', description: 'Actually change supported application settings through the app, with preview and explicit approval. Applies to subsequent requests. Supported keys: language (system/zh-CN/en-US), theme (auto/light/dark), timeZone, webSearchMode (off/auto/on), temperature (0-2), enableTemperature, maxTokens (1-131072), enableMaxTokens, messageSendShortcut (enter/ctrl-enter), floatingMascotVisible, floatingMascotHints. No credentials or permissions can be changed.', parameters: { type: 'object', required: ['settings'], properties: { settings: { type: 'object', additionalProperties: true } } } } },
  { type: 'function' as const, function: { name: 'configure_assistant_skill', description: 'Create or update an instruction skill in the current project and bind it to this assistant. Requires explicit approval. Before updating an existing skill, read its full instructions with get_application_configuration(skillId) and preserve rules the user did not ask to change. Provide complete instructions, not a file path. To install a remote Skill.md the user can send its URL with an install request. Does not install software, executable plugins or MCP servers.', parameters: { type: 'object', required: ['name', 'instructions'], properties: { skillId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' } } } } }
]
export function isApplicationChange(tool: string) { return tool === 'update_application_settings' || tool === 'configure_assistant_skill' }
let settingsApplied = (saved: AppSettings, _previous: AppSettings) => broadcast('settings:changed', saved)
export function setApplicationSettingsListener(listener: typeof settingsApplied) { settingsApplied = listener }
function scope(request: WorkspaceAgentRequest) {
  const projectId = request.assistant.projectId ?? getActiveProjectId()
  const assistant = getAssistants(projectId).find(item => item.id === request.assistant.id)
  if (!assistant) throw new Error('The target assistant no longer exists')
  return { projectId, assistant }
}
function broadcast(channel: string, data: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    try { if (!window.isDestroyed()) window.webContents.send(channel, data) } catch { /* Saved state remains authoritative. */ }
  }
}
export function getApplicationConfiguration(request: WorkspaceAgentRequest, skillId?: unknown) {
  const { projectId, assistant } = scope(request), settings = getSettings()
  if (skillId !== undefined) {
    const skill = getSkills(projectId).find(item => item.id === skillId)
    if (!skill) throw new Error('Skill not found in this workspace')
    return { skill: { id: skill.id, name: skill.name, instructions: skill.instructions, description: skill.description, version: skill.version, status: skill.status } }
  }
  return { settings: Object.fromEntries(assistantSettingKeys.map(key => [key, settings[key]])), assistant: { id: assistant.id, name: assistant.name },
    skills: getSkills(projectId).map(skill => ({ id: skill.id, name: skill.name, description: skill.description, status: skill.status, bound: assistant.skillIds?.includes(skill.id) ?? false })),
    extensions: { httpFunctions: true, mcpRuntime: false, pluginRuntime: false } }
}
export function prepareApplicationChange(request: WorkspaceAgentRequest, tool: string, args: Record<string, unknown>) {
  if (tool === 'update_application_settings') {
    const patch = validateAssistantSettings(args.settings), before = getSettings()
    const changes = Object.entries(patch).map(([key, value]) => ({ setting: key, before: before[key as keyof typeof before], after: value }))
    const english = mainT('main.locale', request.settings.language) === 'en-US'
    const labels: Record<string, string> = { language: '界面语言', theme: '外观主题', timeZone: '时区', webSearchMode: '联网搜索', temperature: '温度', enableTemperature: '自定义温度', maxTokens: '最大输出词元数', enableMaxTokens: '限制输出长度', messageSendShortcut: '发送快捷键', floatingMascotVisible: '显示桌面助手', floatingMascotHints: '桌面助手提示' }
    const value = (item: unknown) => english ? String(item) : typeof item === 'boolean' ? (item ? '开启' : '关闭') : ({ dark: '深色', light: '浅色', auto: '自动', on: '开启', off: '关闭', system: '跟随系统', 'zh-CN': '简体中文', 'en-US': 'English', enter: 'Enter', 'ctrl-enter': 'Ctrl/Command + Enter' } as Record<string, string>)[String(item)] ?? String(item)
    const preview = [english ? 'Application settings (all workspaces)' : '软件设置（影响所有空间）', ...changes.map(change => `${english ? change.setting : labels[change.setting]}: ${value(change.before)} → ${value(change.after)}`), english ? 'Saved immediately; current request keeps its captured settings.' : '保存后生效；本轮任务继续使用开始时的设置。'].join('\n')
    return { preview, commit() {
      const current = getSettings()
      for (const key of Object.keys(patch) as Array<keyof typeof patch>) if (current[key] !== before[key]) throw new Error('Settings changed while awaiting approval; review a fresh preview')
      const saved = setSettings({ ...current, ...patch })
      if (!Object.entries(patch).every(([key, value]) => saved[key as keyof typeof saved] === value)) {
        setSettings(current)
        throw new Error('The app rejected a setting; previous settings were restored')
      }
      try { settingsApplied(saved, current) } catch { broadcast('settings:changed', saved) }
      return { saved: true, changes, verified: true, appliesTo: 'subsequent requests' }
    } }
  }
  if (tool !== 'configure_assistant_skill') throw new Error('Unknown application configuration tool')
  const { projectId, assistant } = scope(request)
  const name = String(args.name ?? '').trim(), instructions = String(args.instructions ?? '').trim()
  if (!name || name.length > 100 || !instructions || instructions.length > 50000) throw new Error('Provide a skill name (1-100 characters) and complete instructions (1-50000 characters)')
  const existing = args.skillId ? getSkills(projectId).find(item => item.id === args.skillId) : undefined
  if (args.skillId && !existing) throw new Error('Skill not found in this workspace')
  if (!existing && getSkills(projectId).some(item => item.name === name)) throw new Error('A skill with this name already exists; supply its skillId to update it')
  const english = mainT('main.locale', request.settings.language) === 'en-US'
  const preview = english ? `Assistant: ${assistant.name}\nSkill: ${name}\nPrevious instructions:\n${existing?.instructions ?? '(new skill)'}\nNew instructions:\n${instructions}` : `绑定助手：${assistant.name}\n技能：${name}\n原说明：\n${existing?.instructions ?? '（新技能）'}\n新说明：\n${instructions}`
  return { preview, commit() {
    const current = scope(request).assistant
    if (existing && getSkills(projectId).find(item => item.id === existing.id)?.instructions !== existing.instructions) throw new Error('Skill changed while awaiting approval; review a fresh preview')
    if (!existing && getSkills(projectId).some(item => item.name === name)) throw new Error('Skill appeared while awaiting approval; review a fresh preview')
    const now = Date.now()
    const skill = saveSkill({ ...(existing ? evolveSkill(existing, instructions, 'Before assistant configuration', now) : { id: `skill_${randomUUID()}`, toolIds: [], version: '1.0.0', sourceType: 'local' as const, createdAt: now }),
      lastEvaluation: undefined,
      name, instructions, description: String(args.description ?? existing?.description ?? '').slice(0, 1000), projectId, status: 'active', updatedAt: now }, projectId)
    try { saveAssistant({ ...current, projectId, skillIds: [...new Set([...(current.skillIds ?? []), skill.id])] }, projectId) }
    catch (error) { if (existing) saveSkill(existing, projectId); else deleteSkill(skill.id); throw error }
    broadcast('assistant:capabilities-changed', { projectId, assistants: getAssistants(projectId), skills: getSkills(projectId) })
    return { saved: true, skill: { id: skill.id, name: skill.name }, boundAssistant: current.id, appliesTo: 'subsequent requests' }
  } }
}
