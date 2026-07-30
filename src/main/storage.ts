/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import { app } from 'electron'
import Store from 'electron-store'
import type { TOptions } from 'i18next'
import JSZip from 'jszip'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { DEFAULT_ASSISTANTS } from '../shared/assistants'
import { inferModelType, normalizeModelCapabilities } from '../shared/modelCapabilities'
import { DEFAULT_PROVIDER, DEFAULT_PROVIDER_ID } from '../shared/providers'
import { sanitizeAssistantSystemPrompt, universalFallbackPrompt } from '../shared/assistantPromptPolicy'
import type {
  ApiProvider,
  AppSettings,
  AppTheme,
  Assistant,
  AssistantColor,
  AssistantIcon,
  AssistantMemory,
  ChatMessage,
  Conversation,
  ConversationSearchSource,
  DataArchiveResult,
  DataLocationChangeResult,
  DataLocationInfo,
  KnowledgeReference,
  MessageSendShortcut,
  KnowledgeNote,
  PreparedAttachment,
  Project,
  ProviderModel,
  ReasoningEffort,
  ToolConfig,
  ToolConfigType,
  ThemeEntitlementResult,
  ThemeRequestUsage,
  WebSearchActivity,
  WebSearchResult
} from '../shared/types'
import { sanitizeAppLanguage } from '../shared/i18n'
import { mainT } from './i18n'

type LegacySettings = Partial<AppSettings> & {
  apiBaseUrl?: string
  apiKey?: string
  defaultModel?: string
}

interface StoreSchema {
  settings: LegacySettings
  activeProjectId: string
  projects: Project[]
  providers: ApiProvider[]
  assistants: Assistant[]
  assistantOrders: Record<string, string[]>
  deletedBuiltInAssistants: string[]
  conversations: Conversation[]
  notes: KnowledgeNote[]
  memories: AssistantMemory[]
  tools: ToolConfig[]
  installationId: string
  themeRequestUsage: ThemeRequestUsage
}

interface DataLocationConfig {
  customDataRoot?: string
  updatedAt?: number
}

const dataLocationFileName = 'data-location.json'
const installerDataLocationFileName = 'data-location.txt'
const storeFileName = 'g-llm-client.json'
const archiveManifestFileName = 'g-llm-data-archive.json'
const dataResourceProtocol = 'gllm-data'
const generatedImagesDirectoryName = 'generated-images'
const importBackupPrefix = 'backup-before-gllm-import-'
const migrationBackupPrefix = 'backup-before-gllm-migration-'
const defaultProjectId = 'project_default'
const assistantColors: AssistantColor[] = ['ink', 'green', 'amber', 'blue', 'rose', 'teal', 'violet', 'slate']
const assistantIcons: AssistantIcon[] = [
  'sparkles',
  'file',
  'scale',
  'code',
  'chart',
  'graduation',
  'brain',
  'briefcase',
  'pen'
]
const reasoningEfforts: ReasoningEffort[] = ['default', 'low', 'medium', 'high']

function sanitizeReasoningEffort(value: unknown): ReasoningEffort {
  return reasoningEfforts.includes(value as ReasoningEffort) ? value as ReasoningEffort : 'default'
}

function getPortableDataRoot(): string | null {
  if (process.platform !== 'win32' || !app.isPackaged) return null

  const installRoot = dirname(process.execPath)
  const portableMarker = join(installRoot, 'portable.flag')
  if (!existsSync(portableMarker)) return null

  return join(installRoot, 'UserData')
}

function getDefaultDataRoot(): string {
  return getPortableDataRoot() ?? (process.platform === 'win32' ? join(app.getPath('appData'), 'G-LLM') : app.getPath('userData'))
}

function getDataLocationConfigPath(defaultRoot = getDefaultDataRoot()): string {
  return join(defaultRoot, dataLocationFileName)
}

function getInstallerDataLocationConfigPath(defaultRoot = getDefaultDataRoot()): string {
  return join(defaultRoot, installerDataLocationFileName)
}

function normalizePathForCompare(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right)
}

function isPathInside(child: string, parent: string): boolean {
  const childPath = normalizePathForCompare(child)
  const parentPath = normalizePathForCompare(parent)
  const diff = relative(parentPath, childPath)
  return Boolean(diff) && !diff.startsWith('..') && !isAbsolute(diff)
}

function readDataLocationConfig(defaultRoot = getDefaultDataRoot()): DataLocationConfig {
  const configPath = getDataLocationConfigPath(defaultRoot)
  if (!existsSync(configPath)) {
    const installerConfigPath = getInstallerDataLocationConfigPath(defaultRoot)
    if (!existsSync(installerConfigPath)) return {}

    try {
      const customDataRoot = readFileSync(installerConfigPath, 'utf8').trim()
      return customDataRoot ? { customDataRoot } : {}
    } catch {
      return {}
    }
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as DataLocationConfig
  } catch {
    return {}
  }
}

function getConfiguredDataRoot(defaultRoot = getDefaultDataRoot()): string | undefined {
  const config = readDataLocationConfig(defaultRoot)
  const customDataRoot = config.customDataRoot?.trim()
  return customDataRoot ? resolve(customDataRoot) : undefined
}

function resolveDataRoot(): string {
  const defaultRoot = getDefaultDataRoot()
  mkdirSync(defaultRoot, { recursive: true })

  const customDataRoot = getConfiguredDataRoot(defaultRoot)
  if (!customDataRoot) return defaultRoot

  try {
    mkdirSync(customDataRoot, { recursive: true })
    return customDataRoot
  } catch {
    return defaultRoot
  }
}

function getDataMode(): DataLocationInfo['mode'] {
  return getPortableDataRoot() ? 'portable' : 'normal'
}

function createDataLocationInfo(activePath: string): DataLocationInfo {
  const defaultPath = getDefaultDataRoot()
  const customPath = getConfiguredDataRoot(defaultPath)
  const effectivePath = customPath ?? defaultPath

  return {
    mode: getDataMode(),
    activePath,
    defaultPath,
    effectivePath,
    customPath,
    locatorPath: getDataLocationConfigPath(defaultPath),
    isCustom: Boolean(customPath),
    pendingRestart: !isSamePath(activePath, effectivePath)
  }
}

function assertWritableDirectory(path: string): void {
  mkdirSync(path, { recursive: true })
  const probe = join(path, `.gllm-write-test-${process.pid}-${Date.now()}`)
  writeFileSync(probe, 'ok')
  rmSync(probe, { force: true })
}

function isInWindowsProgramFiles(path: string): boolean {
  if (process.platform !== 'win32') return false

  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432]
    .filter((item): item is string => Boolean(item?.trim()))
    .map((item) => resolve(item))

  return roots.some((root) => isSamePath(path, root) || isPathInside(path, root))
}

function assertSafeCustomDataRoot(targetRoot: string, activeRoot: string, defaultRoot: string): void {
  if (isSamePath(targetRoot, activeRoot) || isSamePath(targetRoot, defaultRoot)) return

  if (isPathInside(targetRoot, activeRoot) || isPathInside(activeRoot, targetRoot)) {
    throw new Error(storageT('main.storage.pathOverlap'))
  }

  const appRoot = app.isPackaged ? dirname(process.execPath) : process.cwd()
  if (isSamePath(targetRoot, appRoot) || isPathInside(targetRoot, appRoot)) {
    throw new Error(storageT('main.storage.insideApp'))
  }

  if (isInWindowsProgramFiles(targetRoot)) {
    throw new Error(storageT('main.storage.programFiles'))
  }
}

function copyDataDirectory(sourceRoot: string, targetRoot: string): void {
  if (isSamePath(sourceRoot, targetRoot)) return

  mkdirSync(targetRoot, { recursive: true })
  const entries = existsSync(sourceRoot) ? readdirSync(sourceRoot) : []
  const backupRoot = join(targetRoot, `backup-before-gllm-migration-${Date.now()}`)
  let backupCreated = false

  for (const entry of entries) {
    if (entry === dataLocationFileName || entry === installerDataLocationFileName) continue

    const sourcePath = join(sourceRoot, entry)
    const targetPath = join(targetRoot, entry)
    if (isSamePath(sourcePath, targetPath)) continue

    if (existsSync(targetPath)) {
      if (!backupCreated) {
        mkdirSync(backupRoot, { recursive: true })
        backupCreated = true
      }
      cpSync(targetPath, join(backupRoot, entry), { recursive: true, force: true })
    }

    cpSync(sourcePath, targetPath, { recursive: true, force: true })
  }
}

function writeDataLocationConfig(customDataRoot?: string): void {
  const defaultRoot = getDefaultDataRoot()
  mkdirSync(defaultRoot, { recursive: true })
  const configPath = getDataLocationConfigPath(defaultRoot)
  const installerConfigPath = getInstallerDataLocationConfigPath(defaultRoot)

  if (!customDataRoot) {
    rmSync(configPath, { force: true })
    rmSync(installerConfigPath, { force: true })
    return
  }

  const config: DataLocationConfig = {
    customDataRoot: resolve(customDataRoot),
    updatedAt: Date.now()
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  rmSync(installerConfigPath, { force: true })
}

const activeDataRoot = resolveDataRoot()

export function getDataLocationInfo(): DataLocationInfo {
  return createDataLocationInfo(activeDataRoot)
}

export interface StoredDataResource {
  absolutePath: string
  relativePath: string
  url: string
}

export function getDataResourceProtocol(): string {
  return dataResourceProtocol
}

function getSafeDataResourcePath(relativePath: string): { absolutePath: string; relativePath: string } | null {
  const normalized = normalizeArchivePath(relativePath)
  if (!normalized) return null

  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..' || segment.includes(':') || segment.includes('\0'))) {
    return null
  }

  const absolutePath = resolve(activeDataRoot, ...segments)
  if (!isSamePath(absolutePath, activeDataRoot) && !isPathInside(absolutePath, activeDataRoot)) {
    return null
  }

  return { absolutePath, relativePath: normalized }
}

export function getDataResourceFilePathFromUrl(resourceUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(resourceUrl)
  } catch {
    return null
  }

  if (parsed.protocol !== `${dataResourceProtocol}:`) return null

  const rawPath = `${parsed.hostname}${decodeURIComponent(parsed.pathname)}`
  return getSafeDataResourcePath(rawPath)?.absolutePath ?? null
}

function getCurrentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function normalizeImageExtension(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, '')
  if (normalized === 'jpeg') return 'jpg'
  if (['png', 'jpg', 'webp', 'gif'].includes(normalized)) return normalized
  return 'png'
}

export function saveGeneratedImageResource(buffer: Buffer, extension = 'png'): StoredDataResource {
  const safeExtension = normalizeImageExtension(extension)
  const relativePath = normalizeArchivePath(
    join(generatedImagesDirectoryName, getCurrentYearMonth(), `${randomUUID()}.${safeExtension}`)
  )
  const target = getSafeDataResourcePath(relativePath)
  if (!target) throw new Error(storageT('main.storage.generatedImagePathInvalid'))

  mkdirSync(dirname(target.absolutePath), { recursive: true })
  writeFileSync(target.absolutePath, buffer)

  return {
    absolutePath: target.absolutePath,
    relativePath: target.relativePath,
    url: `${dataResourceProtocol}://${target.relativePath}`
  }
}

export function migrateDataRoot(targetRoot: string): DataLocationChangeResult {
  const targetPath = resolve(targetRoot)
  const defaultRoot = getDefaultDataRoot()

  assertSafeCustomDataRoot(targetPath, activeDataRoot, defaultRoot)
  assertWritableDirectory(targetPath)

  if (isSamePath(targetPath, defaultRoot)) {
    return resetDataRoot()
  }

  if (isSamePath(targetPath, activeDataRoot)) {
    return {
      info: getDataLocationInfo(),
      changed: false,
      restartRequired: false,
      message: storageT('main.storage.alreadyUsingDirectory')
    }
  }

  copyDataDirectory(activeDataRoot, targetPath)
  writeDataLocationConfig(targetPath)

  return {
    info: getDataLocationInfo(),
    changed: true,
    restartRequired: true,
    message: storageT('main.storage.directoryChanged')
  }
}

export function adoptExistingDataRoot(targetRoot: string): DataLocationChangeResult {
  const targetPath = resolve(targetRoot)
  const defaultRoot = getDefaultDataRoot()

  assertSafeCustomDataRoot(targetPath, activeDataRoot, defaultRoot)
  assertWritableDirectory(targetPath)

  if (!existsSync(join(targetPath, storeFileName))) {
    throw new Error(storageT('main.storage.noExistingData'))
  }

  if (isSamePath(targetPath, activeDataRoot)) {
    return {
      info: getDataLocationInfo(),
      changed: false,
      restartRequired: false,
      message: storageT('main.storage.alreadyUsingDirectory')
    }
  }

  if (isSamePath(targetPath, defaultRoot)) {
    writeDataLocationConfig(undefined)
  } else {
    writeDataLocationConfig(targetPath)
  }

  return {
    info: getDataLocationInfo(),
    changed: true,
    restartRequired: true,
    message: storageT('main.storage.existingDirectoryAdopted')
  }
}

export function resetDataRoot(): DataLocationChangeResult {
  const defaultRoot = getDefaultDataRoot()

  assertWritableDirectory(defaultRoot)
  if (!isSamePath(activeDataRoot, defaultRoot)) {
    copyDataDirectory(activeDataRoot, defaultRoot)
  }
  writeDataLocationConfig(undefined)

  return {
    info: getDataLocationInfo(),
    changed: !isSamePath(activeDataRoot, defaultRoot),
    restartRequired: !isSamePath(activeDataRoot, defaultRoot),
    message: isSamePath(activeDataRoot, defaultRoot)
      ? storageT('main.storage.alreadyUsingDefault')
      : storageT('main.storage.defaultRestored')
  }
}

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, '/').split('/').filter(Boolean).join('/')
}

function shouldSkipArchiveEntry(relativePath: string): boolean {
  const normalized = normalizeArchivePath(relativePath)
  const [topLevel] = normalized.split('/')

  return (
    !normalized ||
    normalized === archiveManifestFileName ||
    topLevel === dataLocationFileName ||
    topLevel === installerDataLocationFileName ||
    topLevel.startsWith(importBackupPrefix) ||
    topLevel.startsWith(migrationBackupPrefix)
  )
}

function getSafeArchiveTargetPath(entryName: string): string | null {
  const normalized = normalizeArchivePath(entryName)
  if (shouldSkipArchiveEntry(normalized)) return null

  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..' || segment.includes(':') || segment.includes('\0'))) {
    throw new Error(storageT('main.storage.unsafeArchivePath', { path: entryName }))
  }

  const targetPath = resolve(activeDataRoot, ...segments)
  if (!isSamePath(targetPath, activeDataRoot) && !isPathInside(targetPath, activeDataRoot)) {
    throw new Error(storageT('main.storage.archivePathOutside', { path: entryName }))
  }

  return targetPath
}

function addDirectoryToZip(zip: JSZip, rootPath: string, currentPath = rootPath): number {
  let fileCount = 0
  const entries = existsSync(currentPath) ? readdirSync(currentPath) : []

  for (const entry of entries) {
    const sourcePath = join(currentPath, entry)
    const relativePath = normalizeArchivePath(relative(rootPath, sourcePath))
    if (shouldSkipArchiveEntry(relativePath)) continue

    const stat = statSync(sourcePath)
    if (stat.isDirectory()) {
      fileCount += addDirectoryToZip(zip, rootPath, sourcePath)
      continue
    }

    if (!stat.isFile()) continue
    zip.file(relativePath, readFileSync(sourcePath), { date: stat.mtime })
    fileCount += 1
  }

  return fileCount
}

function backupAndClearActiveDataRoot(): string | undefined {
  const entries = existsSync(activeDataRoot) ? readdirSync(activeDataRoot) : []
  const backupRoot = join(activeDataRoot, `${importBackupPrefix}${Date.now()}`)
  let hasBackup = false

  for (const entry of entries) {
    if (shouldSkipArchiveEntry(entry)) continue

    const sourcePath = join(activeDataRoot, entry)
    if (!hasBackup) {
      mkdirSync(backupRoot, { recursive: true })
      hasBackup = true
    }

    cpSync(sourcePath, join(backupRoot, entry), { recursive: true, force: true })
    rmSync(sourcePath, { recursive: true, force: true })
  }

  return hasBackup ? backupRoot : undefined
}

export async function exportDataArchive(outputPath: string): Promise<DataArchiveResult> {
  const targetPath = resolve(outputPath)
  mkdirSync(dirname(targetPath), { recursive: true })

  const zip = new JSZip()
  zip.file(
    archiveManifestFileName,
    JSON.stringify(
      {
        app: 'G-LLM',
        format: 'g-llm-data-archive',
        version: 1,
        exportedAt: new Date().toISOString()
      },
      null,
      2
    )
  )

  const fileCount = addDirectoryToZip(zip, activeDataRoot)
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })

  writeFileSync(targetPath, content)

  return {
    path: targetPath,
    fileCount,
    byteSize: content.byteLength,
    message: storageT('main.storage.exported', { count: fileCount })
  }
}

export async function importDataArchive(archivePath: string): Promise<DataArchiveResult> {
  const sourcePath = resolve(archivePath)
  const zip = await JSZip.loadAsync(readFileSync(sourcePath))
  const entries = Object.values(zip.files).filter((entry) => !entry.dir)
  const filesToExtract = entries
    .map((entry) => ({ entry, targetPath: getSafeArchiveTargetPath(entry.name) }))
    .filter((item): item is { entry: JSZip.JSZipObject; targetPath: string } => Boolean(item.targetPath))

  if (filesToExtract.length === 0) {
    throw new Error(storageT('main.storage.emptyArchive'))
  }

  assertWritableDirectory(activeDataRoot)
  const backupPath = backupAndClearActiveDataRoot()

  for (const { entry, targetPath } of filesToExtract) {
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, await entry.async('nodebuffer'))
  }

  return {
    path: sourcePath,
    backupPath,
    fileCount: filesToExtract.length,
    restartRequired: true,
    message: storageT('main.storage.imported', { count: filesToExtract.length })
  }
}

export const defaultSettings: AppSettings = {
  activeProviderId: DEFAULT_PROVIDER_ID,
  language: 'system',
  timeZone: 'system',
  theme: 'auto',
  temperature: 1,
  enableTemperature: false,
  maxTokens: 4096,
  enableMaxTokens: false,
  messageSendShortcut: 'enter',
  floatingMascotSkin: 'auto',
  floatingMascotHints: true,
  floatingMascotVisible: true,
  telemetryEnabled: true,
  setupCompleted: false
}

const store = new Store<StoreSchema>({
  name: 'g-llm-client',
  cwd: activeDataRoot,
  defaults: {
    settings: defaultSettings,
    activeProjectId: defaultProjectId,
    projects: [],
    providers: [],
    assistants: [],
    assistantOrders: {},
    deletedBuiltInAssistants: [],
    conversations: [],
    notes: [],
    memories: [],
    tools: [],
    installationId: '',
    themeRequestUsage: {
      totalRequests: 0,
      officialRequests: 0
    }
  }
})

function storageT(key: string, options?: TOptions): string {
  const settings = store.get('settings', defaultSettings)
  return mainT(key, sanitizeAppLanguage(settings.language), options)
}

const defaultProjectName = '无极界'
const defaultProjectDescription = '默认空间，用于保存你的通用助手、历史会话和全局资料'

function getDefaultProject(): Project {
  const now = Date.now()
  return {
    id: defaultProjectId,
    name: defaultProjectName,
    description: defaultProjectDescription,
    createdAt: now,
    updatedAt: now
  }
}

function sanitizeProject(project: Project): Project {
  const now = Date.now()
  const id = String(project.id ?? '').trim() || `project_${now}_${Math.random().toString(16).slice(2)}`
  const rawName = String(project.name ?? '').trim().slice(0, 40)
  const rawDescription = String(project.description ?? '').trim().slice(0, 300)
  const isDefaultProject = id === defaultProjectId

  return {
    id,
    name: isDefaultProject && (!rawName || rawName === '默认项目') ? defaultProjectName : rawName || '未命名空间',
    description:
      isDefaultProject && (!rawDescription || rawDescription === '迁移后的历史数据与全局资料')
        ? defaultProjectDescription
        : rawDescription || undefined,
    logoDataUrl: isDefaultProject ? undefined : sanitizeProjectLogo(project.logoDataUrl),
    modelProviderId: project.modelProviderId?.trim() || undefined,
    modelId: project.modelId?.trim() || undefined,
    workspacePath: project.workspacePath?.trim() || undefined,
    workspacePermission: project.workspacePath ? 'read-write' : undefined,
    createdAt: Number.isFinite(project.createdAt) ? Number(project.createdAt) : now,
    updatedAt: now
  }
}

function sanitizeProjectId(value: unknown, fallback = defaultProjectId): string {
  const projectId = String(value ?? '').trim()
  return projectId || fallback
}

function sanitizeProjectLogo(value: unknown): string | undefined {
  const logoDataUrl = String(value ?? '').trim()
  if (!logoDataUrl || !logoDataUrl.startsWith('data:image/')) return undefined

  return logoDataUrl.length <= 2_000_000 ? logoDataUrl : undefined
}

export function getProjects(): Project[] {
  const projects = store.get('projects', []).map(sanitizeProject)
  const hasDefaultProject = projects.some((project) => project.id === defaultProjectId)
  const next = hasDefaultProject ? projects : [getDefaultProject(), ...projects]

  return next
}

export function getActiveProjectId(): string {
  const activeProjectId = sanitizeProjectId(store.get('activeProjectId', defaultProjectId))
  return getProjects().some((project) => project.id === activeProjectId) ? activeProjectId : defaultProjectId
}

export function setActiveProjectId(projectId: string): string {
  const nextProjectId = sanitizeProjectId(projectId)
  const activeProjectId = getProjects().some((project) => project.id === nextProjectId) ? nextProjectId : defaultProjectId
  store.set('activeProjectId', activeProjectId)
  return activeProjectId
}

export function saveProject(project: Project): Project {
  const normalized = sanitizeProject(project)
  const projects = getProjects()
  const next = [normalized, ...projects.filter((item) => item.id !== normalized.id)]
  store.set('projects', next.slice(0, 50))
  return normalized
}

export function deleteProject(projectId: string): void {
  const normalizedProjectId = sanitizeProjectId(projectId)
  if (normalizedProjectId === defaultProjectId) return

  store.set(
    'projects',
    getProjects().filter((project) => project.id !== normalizedProjectId)
  )

  if (getActiveProjectId() === normalizedProjectId) {
    setActiveProjectId(defaultProjectId)
  }
}

function sanitizeProvider(provider: ApiProvider): ApiProvider {
  const now = Date.now()
  const fallbackModel = provider.defaultModel?.trim() || DEFAULT_PROVIDER.defaultModel
  const models = sanitizeModels(provider.models?.length ? provider.models : [{ id: fallbackModel }])
  const chatCompletionsPath = sanitizeEndpointPath(provider.chatCompletionsPath)
  const imageGenerationsPath = sanitizeEndpointPath(provider.imageGenerationsPath)
  const modelsPath = sanitizeEndpointPath(provider.modelsPath)

  return {
    ...DEFAULT_PROVIDER,
    ...provider,
    id: provider.id || DEFAULT_PROVIDER_ID,
    name: provider.name.trim() || '自定义供应商',
    apiBaseUrl: provider.apiBaseUrl.trim().replace(/\/$/, '') || DEFAULT_PROVIDER.apiBaseUrl,
    chatCompletionsPath,
    imageGenerationsPath,
    modelsPath,
    apiKey: provider.apiKey.trim(),
    defaultModel: provider.defaultModel.trim() || models[0]?.id || DEFAULT_PROVIDER.defaultModel,
    models,
    modelsUpdatedAt: provider.modelsUpdatedAt,
    requiresApiKey: provider.requiresApiKey,
    createdAt: provider.createdAt ?? now,
    updatedAt: now
  }
}

function sanitizeEndpointPath(value?: string): string | undefined {
  const path = value?.trim()
  if (!path) return undefined
  return path.startsWith('/') ? path : `/${path}`
}

function sanitizeModels(models: ProviderModel[] = []): ProviderModel[] {
  const seen = new Set<string>()
  const normalized: ProviderModel[] = []

  for (const model of models) {
    const id = model.id?.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    normalized.push({
      id,
      name: model.name?.trim() || id,
      ownedBy: model.ownedBy?.trim(),
      capabilities: normalizeModelCapabilities({
        ...model,
        id
      }),
      type: model.type ?? inferModelType(id)
    })
  }

  return normalized.slice(0, 300)
}

function sanitizeTokenCount(value: unknown): number | undefined {
  const tokenCount = Number(value)
  return Number.isFinite(tokenCount) && tokenCount >= 0 ? Math.round(tokenCount) : undefined
}

function sanitizeAssistantAvatar(value: unknown): string | undefined {
  const avatarDataUrl = String(value ?? '').trim()
  if (!avatarDataUrl || !avatarDataUrl.startsWith('data:image/')) return undefined

  return avatarDataUrl.length <= 1_000_000 ? avatarDataUrl : undefined
}

function sanitizeAttachment(attachment: PreparedAttachment): PreparedAttachment | null {
  const name = String(attachment.name ?? '').trim()
  if (!name) return null

  const kind = attachment.kind === 'image' ? 'image' : 'file'
  const text = attachment.text ? String(attachment.text).slice(0, 40_000) : undefined
  const dataUrl = attachment.dataUrl && attachment.dataUrl.startsWith('data:image/') ? attachment.dataUrl : undefined

  return {
    id: attachment.id?.trim() || `att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name,
    mimeType: String(attachment.mimeType ?? '').trim() || (kind === 'image' ? 'image/*' : 'application/octet-stream'),
    size: Number.isFinite(attachment.size) ? Math.max(0, Number(attachment.size)) : 0,
    kind,
    text,
    dataUrl
  }
}

function sanitizeKnowledgeReference(reference: KnowledgeReference): KnowledgeReference | null {
  const title = String(reference.title ?? '').trim()
  const content = String(reference.content ?? '').trim()
  if (!title || !content) return null

  return {
    id: reference.id?.trim() || `know_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    title: title.slice(0, 80),
    content: content.slice(0, 20_000)
  }
}

function sanitizeWebSearchResult(result: WebSearchResult): WebSearchResult | null {
  const title = String(result.title ?? '').trim()
  const url = String(result.url ?? '').trim()
  if (!title || !/^https?:\/\//i.test(url)) return null

  return {
    title: title.slice(0, 160),
    url: url.slice(0, 1000),
    snippet: result.snippet ? String(result.snippet).trim().slice(0, 500) : undefined,
    excerpt: result.excerpt ? String(result.excerpt).trim().slice(0, 1000) : undefined
  }
}

function sanitizeWebSearchActivity(activity?: WebSearchActivity): WebSearchActivity | undefined {
  if (!activity) return undefined

  const query = String(activity.query ?? '').trim()
  if (!query) return undefined

  const statusOptions: WebSearchActivity['status'][] = ['planning', 'searching', 'completed', 'failed']
  const status = statusOptions.includes(activity.status) ? activity.status : 'completed'
  const results = (activity.results ?? [])
    .map(sanitizeWebSearchResult)
    .filter((result): result is WebSearchResult => Boolean(result))
    .slice(0, 8)
  const queries = Array.isArray(activity.queries)
    ? activity.queries.map((query) => String(query).trim().slice(0, 120)).filter(Boolean).slice(0, 4)
    : undefined

  return {
    status,
    query: query.slice(0, 300),
    intent: activity.intent ? String(activity.intent).trim().slice(0, 180) : undefined,
    queries,
    results,
    error: activity.error ? String(activity.error).trim().slice(0, 300) : undefined,
    searchedAt: Number.isFinite(activity.searchedAt) ? Number(activity.searchedAt) : undefined
  }
}

function sanitizeMessageSendShortcut(value: unknown): MessageSendShortcut {
  return value === 'ctrl-enter' ? 'ctrl-enter' : 'enter'
}

function sanitizeAppTheme(value: unknown): AppTheme {
  return value === 'auto' || value === 'dark' || value === 'gold' ? value : 'light'
}

function sanitizeTimeZone(value: unknown): string {
  if (value === 'system') return 'system'
  if (typeof value !== 'string' || !value.trim()) return 'system'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return value
  } catch {
    return 'system'
  }
}

function sanitizeMessage(message: ChatMessage): ChatMessage {
  const role = message.role === 'assistant' || message.role === 'user' || message.role === 'system' ? message.role : 'user'
  const content = String(message.content ?? '')
  const inferredError =
    message.error?.trim() ||
    (role === 'assistant'
      ? content.match(/^(?:\u8bf7\u6c42\u5931\u8d25|\u53d1\u9001\u5931\u8d25)\uff1a(.+)$/)?.[1]?.trim()
      : undefined)
  const translation = message.translation?.trim()
  const attachments = (message.attachments ?? [])
    .map(sanitizeAttachment)
    .filter((attachment): attachment is PreparedAttachment => Boolean(attachment))
    .slice(0, 8)
  const knowledgeRefs = (message.knowledgeRefs ?? [])
    .map(sanitizeKnowledgeReference)
    .filter((reference): reference is KnowledgeReference => Boolean(reference))
    .slice(0, 8)

  return {
    id: message.id?.trim() || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    role,
    content,
    error: inferredError || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    knowledgeRefs: knowledgeRefs.length > 0 ? knowledgeRefs : undefined,
    webSearch: sanitizeWebSearchActivity(message.webSearch),
    workspaceActivities: (message.workspaceActivities ?? []).slice(0, 80).map((activity) => ({
      id: String(activity.id ?? '').trim() || `activity_${Date.now()}`,
      tool: String(activity.tool ?? '').trim(),
      label: String(activity.label ?? '').trim() || '工作区操作',
      status: activity.status === 'running' || activity.status === 'failed' ? activity.status : 'completed',
      detail: activity.detail ? String(activity.detail).slice(0, 500) : undefined
    })),
    workspaceChangedFiles: (message.workspaceChangedFiles ?? []).map(String).filter(Boolean).slice(0, 100),
    workspaceArtifactRoot: message.workspaceArtifactRoot?.trim() || undefined,
    retryAttempts: (message.retryAttempts ?? []).slice(-12).map((attempt) => ({
      attemptedAt: Number.isFinite(attempt.attemptedAt) ? Number(attempt.attemptedAt) : Date.now(),
      error: String(attempt.error ?? '').trim().slice(0, 500) || '工作区任务失败',
      activities: (attempt.activities ?? []).slice(0, 80).map((activity) => ({
        id: String(activity.id ?? '').trim() || `activity_${Date.now()}`,
        tool: String(activity.tool ?? '').trim(),
        label: String(activity.label ?? '').trim() || '工作区操作',
        status: activity.status === 'running' || activity.status === 'failed' ? activity.status : 'completed',
        detail: activity.detail ? String(activity.detail).slice(0, 500) : undefined
      }))
    })),
    translation: translation || undefined,
    tokenCount: sanitizeTokenCount(message.tokenCount),
    inputTokens: sanitizeTokenCount(message.inputTokens),
    outputTokens: sanitizeTokenCount(message.outputTokens),
    createdAt: Number.isFinite(message.createdAt) ? Number(message.createdAt) : Date.now()
  }
}

function sanitizeConversation(conversation: Conversation, fallbackProjectId = getActiveProjectId()): Conversation {
  const now = Date.now()
  const workspace =
    conversation.workspace?.rootPath?.trim()
      ? {
          rootPath: conversation.workspace.rootPath.trim(),
          displayName: conversation.workspace.displayName?.trim() || basename(conversation.workspace.rootPath),
          permission: conversation.workspace.permission === 'read' ? 'read' as const : 'read-write' as const,
          approvalMode: ['ask', 'auto', 'full'].includes(conversation.workspace.approvalMode ?? '')
            ? conversation.workspace.approvalMode
            : 'ask' as const,
          grantedAt: Number.isFinite(conversation.workspace.grantedAt) ? conversation.workspace.grantedAt : now,
          lastVerifiedAt: Number.isFinite(conversation.workspace.lastVerifiedAt) ? conversation.workspace.lastVerifiedAt : now
        }
      : undefined
  const messages = (conversation.messages ?? []).map(sanitizeMessage).map((message) => {
    if (message.role !== 'assistant' || !workspace || (message.workspaceChangedFiles?.length ?? 0) > 0) return message
    const candidates = Array.from(message.content.matchAll(/`([^`\r\n]+\.(?:pdf|png|jpe?g|webp|gif|docx?|xlsx?|pptx?|zip|txt|md|csv|json|html?|css|jsx?|tsx?|py))`/gi))
      .map((match) => match[1].trim())
      .filter((file, index, files) => files.indexOf(file) === index)
      .filter((file) => {
        if (isAbsolute(file)) return false
        const target = resolve(workspace.rootPath, file)
        return isPathInside(target, workspace.rootPath) && existsSync(target) && statSync(target).isFile()
      })
    return candidates.length > 0
      ? { ...message, workspaceChangedFiles: candidates, workspaceArtifactRoot: workspace.rootPath }
      : message
  })
  const totalTokens =
    sanitizeTokenCount(conversation.totalTokens) ??
    messages.reduce((sum, message) => sum + (sanitizeTokenCount(message.tokenCount) ?? 0), 0)
  const totalInputTokens =
    sanitizeTokenCount(conversation.totalInputTokens) ??
    messages.reduce((sum, message) => sum + (sanitizeTokenCount(message.inputTokens) ?? 0), 0)
  const totalOutputTokens =
    sanitizeTokenCount(conversation.totalOutputTokens) ??
    messages.reduce((sum, message) => sum + (sanitizeTokenCount(message.outputTokens) ?? 0), 0)
  const memory = conversation.projectMemory
  const sanitizeMemoryItems = (items: unknown, limit: number) => Array.isArray(items)
    ? items.map(String).map((item) => item.trim()).filter(Boolean).slice(0, limit)
    : []
  const projectMemory = memory && typeof memory === 'object'
    ? {
        overview: String(memory.overview ?? '').trim().slice(0, 4000),
        requirements: sanitizeMemoryItems(memory.requirements, 80),
        decisions: sanitizeMemoryItems(memory.decisions, 80),
        businessRules: sanitizeMemoryItems(memory.businessRules, 80),
        entities: sanitizeMemoryItems(memory.entities, 80),
        openItems: sanitizeMemoryItems(memory.openItems, 80),
        risks: sanitizeMemoryItems(memory.risks, 80),
        updatedAt: Number.isFinite(memory.updatedAt) ? Number(memory.updatedAt) : now,
        sourceMessageCount: Number.isFinite(memory.sourceMessageCount) ? Math.max(0, Number(memory.sourceMessageCount)) : 0
      }
    : undefined

  return {
    ...conversation,
    id: conversation.id?.trim() || `conv_${now}_${Math.random().toString(16).slice(2)}`,
    projectId: sanitizeProjectId(conversation.projectId, fallbackProjectId),
    assistantId: conversation.assistantId?.trim() || DEFAULT_ASSISTANTS[0].id,
    title: conversation.title?.trim() || '新会话',
    messages,
    modelProviderId: conversation.modelProviderId?.trim() || undefined,
    modelId: conversation.modelId?.trim() || undefined,
    reasoningEffort: sanitizeReasoningEffort(conversation.reasoningEffort),
    workspace,
    projectMemory,
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    createdAt: Number.isFinite(conversation.createdAt) ? Number(conversation.createdAt) : now,
    updatedAt: Number.isFinite(conversation.updatedAt) ? Number(conversation.updatedAt) : now
  }
}

function sanitizeNote(note: KnowledgeNote, fallbackProjectId = getActiveProjectId()): KnowledgeNote {
  const now = Date.now()
  const content = String(note.content ?? '').trim()

  return {
    id: note.id?.trim() || `note_${now}_${Math.random().toString(16).slice(2)}`,
    projectId: sanitizeProjectId(note.projectId, fallbackProjectId),
    title: String(note.title ?? '').trim() || content.slice(0, 32) || '未命名笔记',
    content,
    assistantId: note.assistantId?.trim() || undefined,
    conversationId: note.conversationId?.trim() || undefined,
    messageId: note.messageId?.trim() || undefined,
    createdAt: Number.isFinite(note.createdAt) ? Number(note.createdAt) : now,
    updatedAt: Number.isFinite(note.updatedAt) ? Number(note.updatedAt) : now
  }
}

function sanitizeMemory(memory: AssistantMemory, fallbackProjectId = getActiveProjectId()): AssistantMemory | null {
  const now = Date.now()
  const content = String(memory.content ?? '').trim()
  const assistantId = String(memory.assistantId ?? '').trim()
  if (!assistantId || !content) return null

  return {
    id: memory.id?.trim() || `memory_${now}_${Math.random().toString(16).slice(2)}`,
    projectId: sanitizeProjectId(memory.projectId, fallbackProjectId),
    assistantId,
    content: content.slice(0, 4000),
    enabled: Boolean(memory.enabled),
    sourceNoteId: memory.sourceNoteId?.trim() || undefined,
    sourceMessageId: memory.sourceMessageId?.trim() || undefined,
    createdAt: Number.isFinite(memory.createdAt) ? Number(memory.createdAt) : now,
    updatedAt: now
  }
}

function sanitizeTool(tool: ToolConfig, fallbackProjectId = getActiveProjectId()): ToolConfig {
  const now = Date.now()
  const typeOptions: ToolConfigType[] = ['function', 'mcp', 'plugin']
  const type = typeOptions.includes(tool.type) ? tool.type : 'function'

  return {
    id: tool.id?.trim() || `tool_${now}_${Math.random().toString(16).slice(2)}`,
    projectId: sanitizeProjectId(tool.projectId, fallbackProjectId),
    type,
    name: String(tool.name ?? '').trim() || (type === 'mcp' ? 'MCP 服务' : type === 'plugin' ? '外部插件' : '函数工具'),
    description: String(tool.description ?? '').trim().slice(0, 600) || undefined,
    endpoint: String(tool.endpoint ?? '').trim().slice(0, 1000) || undefined,
    enabled: Boolean(tool.enabled),
    createdAt: Number.isFinite(tool.createdAt) ? Number(tool.createdAt) : now,
    updatedAt: now
  }
}

function getMigratedDefaultProvider(): ApiProvider {
  const legacy = store.get('settings', defaultSettings) as LegacySettings
  const legacyUrl = legacy.apiBaseUrl?.trim()
  const apiBaseUrl = legacyUrl && legacyUrl !== 'https://api.g-llm.com/v1' ? legacyUrl : DEFAULT_PROVIDER.apiBaseUrl

  return sanitizeProvider({
    ...DEFAULT_PROVIDER,
    apiBaseUrl,
    apiKey: legacy.apiKey ?? '',
    defaultModel: legacy.defaultModel?.trim() || DEFAULT_PROVIDER.defaultModel
  })
}

export function getProviders(): ApiProvider[] {
  const providers = store.get('providers', [])
  const normalized = providers.map(sanitizeProvider)
  const hasDefaultProvider = normalized.some((provider) => provider.id === DEFAULT_PROVIDER_ID)

  if (normalized.length === 0) {
    return [getMigratedDefaultProvider()]
  }

  return hasDefaultProvider ? normalized : [getMigratedDefaultProvider(), ...normalized]
}

export function saveProvider(provider: ApiProvider): ApiProvider {
  const normalized = sanitizeProvider(provider)
  const providers = getProviders()
  const next = [normalized, ...providers.filter((item) => item.id !== normalized.id)]
  store.set('providers', next.slice(0, 40))
  return normalized
}

export function deleteProvider(id: string): void {
  if (id === DEFAULT_PROVIDER_ID) return

  store.set(
    'providers',
    getProviders().filter((provider) => provider.id !== id)
  )

  const settings = getSettings()
  if (settings.activeProviderId === id) {
    setSettings({ ...settings, activeProviderId: DEFAULT_PROVIDER_ID })
  }
}

function sanitizeAssistant(assistant: Assistant, fallbackProjectId = getActiveProjectId()): Assistant {
  const now = Date.now()
  const starterPrompts = assistant.starterPrompts
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .slice(0, 6)

  return {
    ...assistant,
    projectId: sanitizeProjectId(assistant.projectId, fallbackProjectId),
    builtIn: Boolean(assistant.builtIn),
    hidden: Boolean(assistant.hidden),
    name: assistant.name.trim() || '未命名助手',
    title: assistant.title.trim() || '自定义助手',
    tone: assistant.tone.trim() || '专属助手',
    color: assistantColors.includes(assistant.color) ? assistant.color : 'ink',
    icon: assistantIcons.includes(assistant.icon) ? assistant.icon : 'sparkles',
    avatarDataUrl: sanitizeAssistantAvatar(assistant.avatarDataUrl),
    modelProviderId: assistant.modelProviderId?.trim() || undefined,
    modelId: assistant.modelId?.trim() || undefined,
    systemPrompt:
      sanitizeAssistantSystemPrompt(assistant.systemPrompt, universalFallbackPrompt),
    starterPrompts: starterPrompts.length > 0 ? starterPrompts : ['帮我分析这个问题', '帮我写一份方案', '把下面内容整理清楚'],
    createdAt: assistant.createdAt ?? now,
    updatedAt: now
  }
}

export function getSettings(): AppSettings {
  const saved = store.get('settings', defaultSettings) as LegacySettings
  const providers = getProviders()
  const activeProviderId =
    saved.activeProviderId && providers.some((provider) => provider.id === saved.activeProviderId)
      ? saved.activeProviderId
      : DEFAULT_PROVIDER_ID

  return {
    ...defaultSettings,
    activeProviderId,
    language: sanitizeAppLanguage(saved.language),
    timeZone: sanitizeTimeZone(saved.timeZone),
    theme: sanitizeAppTheme(saved.theme),
    temperature: Number.isFinite(saved.temperature)
      ? Math.min(2, Math.max(0, Number(saved.temperature)))
      : defaultSettings.temperature,
    enableTemperature: Boolean(saved.enableTemperature),
    maxTokens: Number.isFinite(saved.maxTokens) ? Math.max(1, Math.round(Number(saved.maxTokens))) : defaultSettings.maxTokens,
    enableMaxTokens: Boolean(saved.enableMaxTokens),
    messageSendShortcut: sanitizeMessageSendShortcut(saved.messageSendShortcut),
    floatingMascotSkin:
      saved.floatingMascotSkin === 'gold' || saved.floatingMascotSkin === 'blue'
        ? saved.floatingMascotSkin
        : 'auto',
    floatingMascotHints:
      saved.floatingMascotHints === undefined ? defaultSettings.floatingMascotHints : Boolean(saved.floatingMascotHints),
    floatingMascotVisible:
      saved.floatingMascotVisible === undefined
        ? defaultSettings.floatingMascotVisible
        : Boolean(saved.floatingMascotVisible),
    telemetryEnabled:
      saved.telemetryEnabled === undefined ? defaultSettings.telemetryEnabled : Boolean(saved.telemetryEnabled),
    setupCompleted: Boolean(saved.setupCompleted)
  }
}

export function setSettings(settings: AppSettings): AppSettings {
  const providers = getProviders()
  const activeProviderId = providers.some((provider) => provider.id === settings.activeProviderId)
    ? settings.activeProviderId
    : DEFAULT_PROVIDER_ID

  const normalized: AppSettings = {
    ...defaultSettings,
    ...settings,
    activeProviderId,
    language: sanitizeAppLanguage(settings.language),
    timeZone: sanitizeTimeZone(settings.timeZone),
    theme: sanitizeAppTheme(settings.theme),
    temperature: Number.isFinite(settings.temperature)
      ? Math.min(2, Math.max(0, Number(settings.temperature)))
      : defaultSettings.temperature,
    enableTemperature: Boolean(settings.enableTemperature),
    maxTokens: Number.isFinite(settings.maxTokens)
      ? Math.max(1, Math.round(Number(settings.maxTokens)))
      : defaultSettings.maxTokens,
    enableMaxTokens: Boolean(settings.enableMaxTokens),
    messageSendShortcut: sanitizeMessageSendShortcut(settings.messageSendShortcut),
    floatingMascotSkin:
      settings.floatingMascotSkin === 'gold' || settings.floatingMascotSkin === 'blue'
        ? settings.floatingMascotSkin
        : 'auto',
    floatingMascotHints:
      settings.floatingMascotHints === undefined
        ? defaultSettings.floatingMascotHints
        : Boolean(settings.floatingMascotHints),
    floatingMascotVisible:
      settings.floatingMascotVisible === undefined
        ? defaultSettings.floatingMascotVisible
        : Boolean(settings.floatingMascotVisible),
    telemetryEnabled:
      settings.telemetryEnabled === undefined ? defaultSettings.telemetryEnabled : Boolean(settings.telemetryEnabled),
    setupCompleted: settings.setupCompleted
  }

  store.set('settings', normalized)
  return normalized
}

export function getInstallationId(): string {
  const existing = store.get('installationId', '').trim()
  if (existing) return existing

  const installationId = randomUUID()
  store.set('installationId', installationId)
  return installationId
}

function sanitizeThemeRequestCount(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(Number(value))) : 0
}

export function getThemeRequestUsage(): ThemeRequestUsage {
  const saved = store.get('themeRequestUsage', { totalRequests: 0, officialRequests: 0 })
  const totalRequests = sanitizeThemeRequestCount(saved.totalRequests)
  const officialRequests = Math.min(totalRequests, sanitizeThemeRequestCount(saved.officialRequests))
  return {
    totalRequests,
    officialRequests,
    updatedAt: Number.isFinite(saved.updatedAt) ? Number(saved.updatedAt) : undefined
  }
}

export function recordThemeRequestUsage(official: boolean): ThemeRequestUsage {
  const current = getThemeRequestUsage()
  const next: ThemeRequestUsage = {
    totalRequests: current.totalRequests + 1,
    officialRequests: current.officialRequests + (official ? 1 : 0),
    updatedAt: Date.now()
  }
  store.set('themeRequestUsage', next)
  return next
}

export function getGoldThemeEntitlement(): ThemeEntitlementResult {
  const usage = getThemeRequestUsage()
  const officialRequestRatio = usage.totalRequests > 0 ? usage.officialRequests / usage.totalRequests : 0
  const eligible = usage.totalRequests > 0 && officialRequestRatio > 0.5
  const percentage = (officialRequestRatio * 100).toFixed(1).replace(/\.0$/, '')
  const summary = storageT('main.theme.requestSummary', {
    official: usage.officialRequests,
    total: usage.totalRequests,
    percentage
  })

  return {
    ok: true,
    eligible,
    totalRequests: usage.totalRequests,
    officialRequests: usage.officialRequests,
    officialRequestRatio,
    message: eligible
      ? storageT('main.theme.eligible', { summary })
      : usage.totalRequests === 0
        ? storageT('main.theme.noUsage')
        : storageT('main.theme.notEligible', { summary })
  }
}

function getAllCustomAssistants(): Assistant[] {
  return store.get('assistants', []).map((assistant) => sanitizeAssistant(assistant, defaultProjectId))
}

function getDeletedBuiltInAssistantKey(projectId: string, assistantId: string): string {
  return `${projectId}:${assistantId}`
}

function getDeletedBuiltInAssistantKeys(): string[] {
  return store.get('deletedBuiltInAssistants', []).filter((value): value is string => typeof value === 'string')
}

export function getCustomAssistants(projectId = getActiveProjectId()): Assistant[] {
  const normalizedProjectId = sanitizeProjectId(projectId)
  return getAllCustomAssistants().filter((assistant) => assistant.projectId === normalizedProjectId)
}

export function getAssistants(projectId = getActiveProjectId()): Assistant[] {
  const normalizedProjectId = sanitizeProjectId(projectId)
  const savedAssistants = getCustomAssistants(normalizedProjectId)
  const defaultIds = new Set(DEFAULT_ASSISTANTS.map((assistant) => assistant.id))
  const savedById = new Map(savedAssistants.map((assistant) => [assistant.id, assistant]))
  const deletedBuiltInAssistantKeys = new Set(getDeletedBuiltInAssistantKeys())
  const defaults = DEFAULT_ASSISTANTS
    .filter(
      (assistant) => !deletedBuiltInAssistantKeys.has(getDeletedBuiltInAssistantKey(normalizedProjectId, assistant.id))
    )
    .map((assistant) => {
      const saved = savedById.get(assistant.id)
      return saved
        ? { ...assistant, ...saved, builtIn: true, projectId: normalizedProjectId }
        : { ...assistant, projectId: normalizedProjectId }
    })
  const custom = savedAssistants.filter((assistant) => !defaultIds.has(assistant.id))

  const assistants = [...defaults, ...custom]
  const order = store.get('assistantOrders', {})[normalizedProjectId] ?? []
  const orderById = new Map(order.map((id, index) => [id, index]))
  return assistants
    .map((assistant, index) => ({ assistant, index }))
    .sort((first, second) => {
      const firstOrder = orderById.get(first.assistant.id)
      const secondOrder = orderById.get(second.assistant.id)
      if (firstOrder === undefined && secondOrder === undefined) return first.index - second.index
      if (firstOrder === undefined) return 1
      if (secondOrder === undefined) return -1
      return firstOrder - secondOrder
    })
    .map(({ assistant }) => assistant)
}

export function reorderAssistants(ids: string[], projectId = getActiveProjectId()): Assistant[] {
  const normalizedProjectId = sanitizeProjectId(projectId)
  const assistants = getAssistants(normalizedProjectId)
  const validIds = new Set(assistants.map((assistant) => assistant.id))
  const orderedIds = Array.from(new Set(ids.filter((id) => typeof id === 'string' && validIds.has(id))))
  const missingIds = assistants.map((assistant) => assistant.id).filter((id) => !orderedIds.includes(id))
  const assistantOrders = store.get('assistantOrders', {})
  store.set('assistantOrders', {
    ...assistantOrders,
    [normalizedProjectId]: [...orderedIds, ...missingIds]
  })
  return getAssistants(normalizedProjectId)
}

export function saveAssistant(assistant: Assistant, projectId = getActiveProjectId()): Assistant {
  const normalized = sanitizeAssistant(assistant, projectId)
  const assistants = getAllCustomAssistants()
  const next = [
    normalized,
    ...assistants.filter((item) => !(item.id === normalized.id && item.projectId === normalized.projectId))
  ]
  store.set('assistants', next.slice(0, 400))
  return normalized
}

export function deleteAssistant(id: string, projectId = getActiveProjectId()): void {
  const normalizedProjectId = sanitizeProjectId(projectId)
  if (DEFAULT_ASSISTANTS.some((assistant) => assistant.id === id)) {
    const deletedKey = getDeletedBuiltInAssistantKey(normalizedProjectId, id)
    store.set('deletedBuiltInAssistants', [...new Set([...getDeletedBuiltInAssistantKeys(), deletedKey])])
  }
  store.set(
    'assistants',
    getAllCustomAssistants().filter((assistant) => !(assistant.id === id && assistant.projectId === normalizedProjectId))
  )
  store.set(
    'conversations',
    getAllConversations().filter(
      (conversation) => !(conversation.assistantId === id && conversation.projectId === normalizedProjectId)
    )
  )
  store.set(
    'notes',
    getAllNotes().filter((note) => !(note.assistantId === id && note.projectId === normalizedProjectId))
  )
  store.set(
    'memories',
    getAllMemories().filter((memory) => !(memory.assistantId === id && memory.projectId === normalizedProjectId))
  )
}

function getAllConversations(): Conversation[] {
  return store.get('conversations', []).map((conversation) => sanitizeConversation(conversation, defaultProjectId))
}

export function getConversationSearchSources(): ConversationSearchSource[] {
  const projects = getProjects()
  const projectNames = new Map(projects.map((project) => [project.id, project.name]))
  const hiddenAssistantIdsByProject = new Map(
    projects.map((project) => [
      project.id,
      new Set(getAssistants(project.id).filter((assistant) => assistant.hidden).map((assistant) => assistant.id))
    ])
  )
  const assistantNamesByProject = new Map(
    projects.map((project) => [
      project.id,
      new Map(getAssistants(project.id).map((assistant) => [assistant.id, assistant.name]))
    ])
  )

  return getAllConversations()
    .filter(
      (conversation) =>
        !hiddenAssistantIdsByProject
          .get(conversation.projectId ?? defaultProjectId)
          ?.has(conversation.assistantId)
    )
    .map((conversation) => ({
    conversationId: conversation.id,
    projectId: conversation.projectId ?? defaultProjectId,
    projectName: projectNames.get(conversation.projectId ?? defaultProjectId) ?? '未命名空间',
    assistantId: conversation.assistantId,
    assistantName:
      assistantNamesByProject.get(conversation.projectId ?? defaultProjectId)?.get(conversation.assistantId) ?? '未知助手',
    title: conversation.title,
    messages: conversation.messages.map((message) => ({ role: message.role, content: message.content })),
    createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt
    }))
}

export function getConversations(projectId = getActiveProjectId()): Conversation[] {
  const normalizedProjectId = sanitizeProjectId(projectId)
  return getAllConversations().filter((conversation) => conversation.projectId === normalizedProjectId)
}

export function saveConversation(conversation: Conversation, projectId = getActiveProjectId()): Conversation {
  const normalized = sanitizeConversation(conversation, projectId)
  const conversations = getAllConversations()
  if (normalized.workspace) {
    const workspaceKey = normalizePathForCompare(normalized.workspace.rootPath)
    const conflict = conversations.find(
      (item) => item.id !== normalized.id && item.workspace && normalizePathForCompare(item.workspace.rootPath) === workspaceKey
    )
    if (conflict) throw new Error(`该工作目录已授权给会话「${conflict.title}」，请先解除原会话授权`)
  }
  const next = [normalized, ...conversations.filter((item) => item.id !== normalized.id)]
  store.set('conversations', next.slice(0, 1000))
  return normalized
}

export function deleteConversation(id: string): void {
  store.set(
    'conversations',
    getAllConversations().filter((conversation) => conversation.id !== id)
  )
}

function getAllNotes(): KnowledgeNote[] {
  return store
    .get('notes', [])
    .map((note) => sanitizeNote(note, defaultProjectId))
    .filter((note) => note.content)
}

export function getNotes(projectId = getActiveProjectId()): KnowledgeNote[] {
  const normalizedProjectId = sanitizeProjectId(projectId)
  return getAllNotes().filter((note) => note.projectId === normalizedProjectId)
}

export function saveNote(note: KnowledgeNote, projectId = getActiveProjectId()): KnowledgeNote {
  const normalized = sanitizeNote(note, projectId)
  const notes = getAllNotes()
  const next = [normalized, ...notes.filter((item) => item.id !== normalized.id)]
  store.set('notes', next.slice(0, 2000))
  return normalized
}

export function deleteNote(id: string): void {
  store.set(
    'notes',
    getAllNotes().filter((note) => note.id !== id)
  )
}

function getAllMemories(): AssistantMemory[] {
  return store
    .get('memories', [])
    .map((memory) => sanitizeMemory(memory, defaultProjectId))
    .filter((memory): memory is AssistantMemory => Boolean(memory))
}

export function getMemories(projectId = getActiveProjectId()): AssistantMemory[] {
  const normalizedProjectId = sanitizeProjectId(projectId)
  return getAllMemories().filter((memory) => memory.projectId === normalizedProjectId)
}

export function saveMemory(memory: AssistantMemory, projectId = getActiveProjectId()): AssistantMemory {
  const normalized = sanitizeMemory(memory, projectId)
  if (!normalized) throw new Error('记忆内容不能为空')

  const memories = getAllMemories()
  const next = [normalized, ...memories.filter((item) => item.id !== normalized.id)]
  store.set('memories', next.slice(0, 1000))
  return normalized
}

export function deleteMemory(id: string): void {
  store.set(
    'memories',
    getAllMemories().filter((memory) => memory.id !== id)
  )
}

function getAllTools(): ToolConfig[] {
  return store.get('tools', []).map((tool) => sanitizeTool(tool, defaultProjectId))
}

export function getTools(projectId = getActiveProjectId()): ToolConfig[] {
  const normalizedProjectId = sanitizeProjectId(projectId)
  return getAllTools().filter((tool) => tool.projectId === normalizedProjectId)
}

export function saveTool(tool: ToolConfig, projectId = getActiveProjectId()): ToolConfig {
  const normalized = sanitizeTool(tool, projectId)
  const tools = getAllTools()
  const next = [normalized, ...tools.filter((item) => item.id !== normalized.id)]
  store.set('tools', next.slice(0, 300))
  return normalized
}

export function deleteTool(id: string): void {
  store.set(
    'tools',
    getAllTools().filter((tool) => tool.id !== id)
  )
}
