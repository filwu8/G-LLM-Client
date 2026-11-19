import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { Assistant, AssistantColor, AssistantIcon, AssistantImportResult } from '../shared/types'

const COLORS: AssistantColor[] = ['ink', 'green', 'amber', 'blue', 'rose', 'teal', 'violet', 'slate']
const ICONS: AssistantIcon[] = ['sparkles', 'file', 'scale', 'code']

function readIfExists(file: string, limit = 6000): string {
  try {
    return fs.readFileSync(file, 'utf8').slice(0, limit).trim()
  } catch {
    return ''
  }
}

/** A seat folder carries its own instructions, memory or data directory. */
function looksLikeSeat(directory: string): boolean {
  return ['AGENTS.md', 'MEMORY.md', 'SEAT.md'].some((file) => fs.existsSync(path.join(directory, file)))
    || fs.existsSync(path.join(directory, 'data'))
    || fs.existsSync(path.join(directory, '.workbuddy'))
}

function workspaceKey(value: string | undefined): string {
  return value ? path.normalize(value).toLowerCase() : ''
}

/**
 * Decide which seats a root folder contains, reusing any assistant that already
 * owns the same directory so a second import updates instead of duplicating.
 *
 * Pure apart from reading the folder: no storage, so it is testable directly.
 */
export function planAssistantImport(
  rootInput: string,
  options: { parentName?: string; existing?: Assistant[] } = {}
): AssistantImportResult {
  const input = rootInput.trim()
  if (!input) throw new Error('需要指定要导入的根目录')
  const root = fs.realpathSync(path.resolve(input))
  if (!fs.statSync(root).isDirectory()) throw new Error(`不是目录：${root}`)
  const existing = options.existing ?? []
  const byWorkspace = new Map<string, Assistant>()
  for (const item of existing) {
    const key = workspaceKey(item.workspaceRoot)
    if (key && !byWorkspace.has(key)) byWorkspace.set(key, item)
  }
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  const seats: Assistant[] = []
  const skipped: { name: string; reason: string }[] = []
  for (const entry of entries) {
    const directory = path.join(root, entry.name)
    if (!looksLikeSeat(directory)) {
      skipped.push({ name: entry.name, reason: '没有 AGENTS.md / MEMORY.md / data / .workbuddy' })
      continue
    }
    const instructions = readIfExists(path.join(directory, 'AGENTS.md')) || readIfExists(path.join(directory, 'MEMORY.md'))
    const current = byWorkspace.get(workspaceKey(directory))
    const index = seats.length
    seats.push({
      id: current?.id ?? randomUUID(),
      name: current?.name ?? entry.name,
      title: current?.title ?? '席位',
      tone: current?.tone ?? 'direct',
      color: current?.color ?? COLORS[index % COLORS.length],
      icon: current?.icon ?? ICONS[index % ICONS.length],
      avatarDataUrl: current?.avatarDataUrl,
      systemPrompt: instructions || current?.systemPrompt
        || `你是「${entry.name}」席位，工作目录是 ${directory}。开始任务前先读该目录的 AGENTS.md 与 MEMORY.md，再动账本。`,
      starterPrompts: current?.starterPrompts ?? [],
      status: current?.status ?? 'active',
      modelProviderId: current?.modelProviderId,
      modelId: current?.modelId,
      skillIds: current?.skillIds,
      toolIds: current?.toolIds,
      parentAssistantId: current?.parentAssistantId,
      workspaceRoot: directory,
      delegateAssistantIds: current?.delegateAssistantIds ?? [],
      createdAt: current?.createdAt ?? Date.now()
    })
  }
  if (seats.length === 0) throw new Error(`在 ${root} 下没有找到任何席位目录`)
  const rootInstructions = readIfExists(path.join(root, 'AGENTS.md')) || readIfExists(path.join(root, 'MEMORY.md'))
  const currentOrchestrator = byWorkspace.get(workspaceKey(root))
  const orchestrator: Assistant = {
    id: currentOrchestrator?.id ?? randomUUID(),
    name: currentOrchestrator?.name ?? (options.parentName?.trim() || '总台'),
    title: currentOrchestrator?.title ?? '总台',
    tone: currentOrchestrator?.tone ?? 'direct',
    color: currentOrchestrator?.color ?? 'ink',
    icon: currentOrchestrator?.icon ?? 'scale',
    avatarDataUrl: currentOrchestrator?.avatarDataUrl,
    systemPrompt: rootInstructions || currentOrchestrator?.systemPrompt
      || `你是总台，负责把任务拆开派给各席位并汇总。可派发的席位：${seats.map((seat) => seat.name).join('、')}。派发时只给边界清晰的一件事，让它自己读文件、动账本。`,
    starterPrompts: currentOrchestrator?.starterPrompts ?? [],
    status: currentOrchestrator?.status ?? 'active',
    modelProviderId: currentOrchestrator?.modelProviderId,
    modelId: currentOrchestrator?.modelId,
    skillIds: currentOrchestrator?.skillIds,
    toolIds: currentOrchestrator?.toolIds,
    workspaceRoot: root,
    delegateAssistantIds: Array.from(new Set([
      ...(currentOrchestrator?.delegateAssistantIds ?? []),
      ...seats.map((seat) => seat.id)
    ])),
    createdAt: currentOrchestrator?.createdAt ?? Date.now()
  }
  return {
    orchestrator,
    seats: seats.map((seat) => ({ ...seat, parentAssistantId: seat.parentAssistantId ?? orchestrator.id })),
    skipped
  }
}
