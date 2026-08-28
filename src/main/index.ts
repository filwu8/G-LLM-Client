/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  nativeImage,
  nativeTheme,
  protocol,
  screen,
  shell,
  Tray,
  type Point,
  type Rectangle
} from 'electron'
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  ApiProvider,
  AppSettings,
  AppUpdateInfo,
  ChatActivityEvent,
  ContextSavings,
  ChatRequest,
  Conversation,
  ConversationChangeEvent,
  FloatingMascotAppearance,
  FloatingMascotHintEvent,
  FloatingMascotSkin,
  LegalDocument,
  MainConversationOpenRequest,
  PreparedAttachment,
  WorkspaceAgentRequest,
  WorkspaceApprovalPrompt
} from '../shared/types'
import { normalizeMainConversationOpenRequest } from '../shared/conversationHandoff'
import {
  DEFAULT_PROVIDER,
  DEFAULT_PROVIDER_ID,
  applyFetchedProviderModels,
  isOfficialGllmApiProvider,
  resolveProviderModelId,
  shouldRefreshProviderModels
} from '../shared/providers'
import { ActiveResponseRegistry } from './activeResponse'
import { AgentRunLedger } from './agentRunLedger'
import { DOWNLOAD_PAGE_URL } from './appUpdate'
import { AutoUpdateManager } from './autoUpdateManager'
import {
  GLLM_DEEP_LINK_SCHEME,
  inspectGllmDeepLinkArguments,
  parseGllmDeepLink,
  redactGllmDeepLinkArguments,
  type GllmDeepLink
} from './deepLink'
import { exchangeGllmHandoff, resolveGllmHandoffExchangeUrl } from './deepLinkHandoff'
import { mainT } from './i18n'
import { redactMainLogText } from './logRedaction'
import {
  checkProviderConnection,
  fetchProviderModels,
  generateAssistantSuggestion,
  searchConversations,
  shouldUpdateConversationProjectMemory,
  streamGllmChat,
  updateConversationProjectMemory
} from './gllmClient'
import {
  adoptExistingDataRoot,
  deleteAssistant,
  deleteConversation,
  deleteMemory,
  deleteNote,
  deleteProject,
  deleteProvider,
  deleteTool,
  exportDataArchive,
  getActiveProjectId,
  getAssistants,
  getConversationSearchSources,
  getConversations,
  getDataResourceFilePathFromUrl,
  getDataResourceProtocol,
  getDataLocationInfo,
  getGoldThemeEntitlement,
  getMemories,
  getNotes,
  getProjects,
  getProviders,
  getSettings,
  getTools,
  importDataArchive,
  migrateDataRoot,
  resetDataRoot,
  recordThemeRequestUsage,
  saveAssistant,
  reorderAssistants,
  saveConversation,
  saveMemory,
  saveNote,
  saveProject,
  saveProvider,
  saveTool,
  setActiveProjectId,
  setSettings
} from './storage'
import {
  getChatTelemetryProperties,
  getErrorCategory,
  getProviderTelemetryProperties,
  trackTelemetryEvent
} from './telemetry'

function getAppIconPath(): string {
  return is.dev ? join(process.cwd(), 'resources/app-icon.png') : join(process.resourcesPath, 'resources/app-icon.png')
}

function getTrayIconPath(useDarkBackground = false): string {
  if (process.platform === 'win32') {
    const filename = useDarkBackground ? 'tray-icon-win-dark.ico' : 'tray-icon-win-light.ico'
    return is.dev ? join(process.cwd(), 'resources', filename) : join(process.resourcesPath, 'resources', filename)
  }

  return is.dev
    ? join(process.cwd(), 'resources/tray-icon-template.png')
    : join(process.resourcesPath, 'resources/tray-icon-template.png')
}

let mainWindow: BrowserWindow | null = null
let quickWindow: BrowserWindow | null = null
let quickWindowReady = false
let quickWindowShowPending = false
let floatingLogoWindow: BrowserWindow | null = null
let floatingMascotHintWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let autoUpdateManager: AutoUpdateManager | null = null
let activeAssistantId = 'general'
let mainHiddenMode: 'none' | 'tray' | 'floating' = 'none'
const conversationMemoryUpdates = new Set<string>()
const activeResponses = new ActiveResponseRegistry()
let agentRunLedger: AgentRunLedger | null = null
const pendingWorkspaceApprovals = new Map<string, { senderId: number; resolve: (approved: boolean) => void }>()
const providerModelCatalogRefreshes = new Map<string, Promise<ApiProvider>>()

async function refreshOfficialProviderCatalog(provider: ApiProvider, force = false): Promise<ApiProvider> {
  const savedProvider = getProviders().find((item) => item.id === provider.id) ?? provider
  if (!isOfficialGllmApiProvider(savedProvider) || !savedProvider.apiKey.trim()) return savedProvider
  if (!force && !shouldRefreshProviderModels(savedProvider)) return savedProvider

  const inFlight = providerModelCatalogRefreshes.get(savedProvider.id)
  if (inFlight) return inFlight

  const refresh = (async () => {
    try {
      const models = await fetchProviderModels(savedProvider, getSettings().language)
      const refreshed = saveProvider(applyFetchedProviderModels(savedProvider, models))
      broadcastProvidersChange(getProviders())
      void trackTelemetryEvent('provider_models_refreshed', getProviderTelemetryProperties(refreshed))
      return refreshed
    } catch (error) {
      void trackTelemetryEvent('provider_models_refresh_failed', {
        ...getProviderTelemetryProperties(savedProvider),
        error_category: getErrorCategory(error)
      })
      throw error
    } finally {
      providerModelCatalogRefreshes.delete(savedProvider.id)
    }
  })()

  providerModelCatalogRefreshes.set(savedProvider.id, refresh)
  return refresh
}

async function refreshStaleOfficialProviderCatalogs(): Promise<void> {
  await Promise.allSettled(
    getProviders()
      .filter((provider) => shouldRefreshProviderModels(provider))
      .map((provider) => refreshOfficialProviderCatalog(provider))
  )
}

async function prepareProviderRequestModel<T extends { provider: ApiProvider }>(
  request: T,
  forceRefresh = false
): Promise<{ request: T; fallbackFrom?: string }> {
  if (!isOfficialGllmApiProvider(request.provider)) return { request }

  let provider = request.provider
  try {
    provider = await refreshOfficialProviderCatalog(provider, forceRefresh)
  } catch (error) {
    if (forceRefresh) throw error
  }

  const requestedModel = request.provider.defaultModel
  const resolvedModel = resolveProviderModelId(provider, requestedModel)
  return {
    request: {
      ...request,
      provider: { ...provider, defaultModel: resolvedModel }
    },
    fallbackFrom: resolvedModel !== requestedModel ? requestedModel : undefined
  }
}

function isModelNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /model_not_found|无可用渠道|no available channel/i.test(message)
}

function registerActiveResponse(
  kind: 'chat' | 'workspace',
  conversationId: string,
  requestKey = 'main'
): { key: string; controller: AbortController } {
  return activeResponses.register(kind, conversationId, requestKey)
}

function releaseActiveResponse(key: string, controller: AbortController): void {
  activeResponses.release({ key, controller })
}

function isCurrentActiveResponse(key: string, controller: AbortController): boolean {
  return activeResponses.isCurrent({ key, controller })
}

function cancelActiveResponse(conversationId: string): void {
  activeResponses.cancelConversation(conversationId)
}

async function maybeUpdateProjectMemory(conversation: Conversation): Promise<void> {
  if (conversationMemoryUpdates.has(conversation.id)) return
  if (!shouldUpdateConversationProjectMemory(conversation.messages, conversation.projectMemory)) return
  const providers = getProviders()
  const settings = getSettings()
  const baseProvider = providers.find((provider) => provider.id === (conversation.modelProviderId || settings.activeProviderId)) ?? providers[0]
  if (!baseProvider) return
  const provider = { ...baseProvider, defaultModel: conversation.modelId || baseProvider.defaultModel }
  conversationMemoryUpdates.add(conversation.id)
  try {
    const projectMemory = await updateConversationProjectMemory(provider, conversation.messages, conversation.projectMemory)
    const latest = getConversations(conversation.projectId).find((item) => item.id === conversation.id)
    if (!latest) return
    const saved = saveConversation({ ...latest, projectMemory, updatedAt: latest.updatedAt }, conversation.projectId)
    broadcastConversationChange(saved.id, 'saved', saved)
  } catch {
    // 项目记忆是后台增强能力，失败不影响正常会话。
  } finally {
    conversationMemoryUpdates.delete(conversation.id)
  }
}
let lastMainWindowBounds: Rectangle | null = null
let floatingLogoBounds: Rectangle | null = null
let floatingLogoDragOffset: Point | null = null
let floatingMascotHintTimer: ReturnType<typeof setTimeout> | null = null
let floatingMascotHintHideTimer: ReturnType<typeof setTimeout> | null = null
let currentFloatingMascotHint: FloatingMascotHintEvent | null = null
let pendingFloatingMascotHint: Omit<FloatingMascotHintEvent, 'placement'> | null = null
let floatingMascotHintIndex = 0

function broadcastChatActivity(activity: ChatActivityEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('chat:activity', activity)
  }
  if (!activity.active && activity.error) {
    pendingFloatingMascotHint = {
      message: mainT('main.floating.requestFailed', getSettings().language),
      tone: 'error'
    }
  }
}

const FLOATING_LOGO_BASE_SIZE = 88
const FLOATING_LOGO_MIN_SIZE = 72
const FLOATING_LOGO_MAX_SIZE = 112
const FLOATING_LOGO_EDGE_GAP = 8
const FLOATING_HINT_WIDTH = 246
const FLOATING_HINT_HEIGHT = 98
const FLOATING_HINT_GAP = 8
const SCREENSHOT_WINDOW_HIDE_DELAY_MS = 180
const APP_USER_MODEL_ID = 'com.gprophet.gllmclient'
const supportsFloatingMascot = process.platform === 'win32' || process.platform === 'darwin'
const gotSingleInstanceLock = app.requestSingleInstanceLock()
const startupDeepLinkResult = inspectGllmDeepLinkArguments(process.argv)
redactGllmDeepLinkArguments(process.argv)
let pendingDeepLink: GllmDeepLink | null =
  startupDeepLinkResult.kind === 'valid' ? startupDeepLinkResult.link : null
let isMainProcessReady = false
const processedHandoffDigests = new Set<string>()
const legalDocumentPaths = {
  license: { development: 'LICENSE', packaged: 'LICENSE.txt' },
  'third-party': { development: 'THIRD_PARTY_NOTICES.md', packaged: 'THIRD_PARTY_NOTICES.md' },
  commercial: { development: 'COMMERCIAL_LICENSE.md', packaged: 'COMMERCIAL_LICENSE.md' },
  trademarks: { development: 'TRADEMARKS.md', packaged: 'TRADEMARKS.md' }
} satisfies Record<LegalDocument, { development: string; packaged: string }>

function isLegalDocument(value: unknown): value is LegalDocument {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(legalDocumentPaths, value)
}

function getLegalDocumentPath(document: LegalDocument): string {
  const fileName = legalDocumentPaths[document]
  return is.dev ? join(process.cwd(), fileName.development) : join(process.resourcesPath, 'legal', fileName.packaged)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: getDataResourceProtocol(),
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
])

if (!gotSingleInstanceLock) {
  app.quit()
}

if (gotSingleInstanceLock) registerGllmDeepLinkProtocol()

app.on('open-url', (event, url) => {
  event.preventDefault()
  if (gotSingleInstanceLock) receiveDeepLink(url, 'macOS open-url event')
})

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

function formatBuildCode(date: Date): string {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes()
  ]

  return parts.map((part) => String(part).padStart(2, '0')).join('')
}

function getAppBuildCode(): string {
  const envBuildCode = process.env.GLLM_BUILD_CODE?.trim()
  if (envBuildCode) return envBuildCode

  try {
    return formatBuildCode(statSync(__filename).mtime)
  } catch {
    return formatBuildCode(new Date())
  }
}

function getMainLogDirectory(): string {
  return join(app.getPath('appData'), 'G-LLM', 'logs')
}

function getAgentRunLedger(): AgentRunLedger {
  agentRunLedger ??= new AgentRunLedger(getMainLogDirectory())
  return agentRunLedger
}

function writeMainLog(message: string, error?: unknown): void {
  try {
    const logDirectory = getMainLogDirectory()
    mkdirSync(logDirectory, { recursive: true })
    const detail =
      error instanceof Error
        ? `${error.stack ?? error.message}`
        : error === undefined
          ? ''
          : String(error)

    const safeMessage = redactMainLogText(message)
    const safeDetail = detail ? redactMainLogText(detail) : ''
    appendFileSync(join(logDirectory, 'main.log'), `[${new Date().toISOString()}] ${safeMessage}${safeDetail ? `\n${safeDetail}` : ''}\n`)
  } catch {
    // Logging must never crash the app.
  }
}

function exportDiagnosticReport(outputPath: string): void {
  const logPath = join(getMainLogDirectory(), 'main.log')
  let mainLogTail: string[] = []
  try {
    mainLogTail = readFileSync(logPath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-500)
      .map((line) => redactMainLogText(line))
  } catch {
    // The structured run ledger remains useful when main.log does not exist yet.
  }
  writeFileSync(outputPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: {
      version: app.getVersion(),
      buildCode: getAppBuildCode(),
      platform: process.platform,
      arch: process.arch
    },
    agentRuns: getAgentRunLedger().snapshot(),
    mainLogTail
  }, null, 2), 'utf8')
}

function buildTruncationWarning(request: ChatRequest, finishReason: string): string {
  const reason = finishReason ? ` (finish_reason=${finishReason})` : ''
  const tokenAdvice = request.settings.enableMaxTokens
    ? mainT('main.chat.maxTokensAdvice', request.settings.language, { tokens: request.settings.maxTokens.toLocaleString() })
    : mainT('main.chat.noMaxTokensAdvice', request.settings.language)
  return mainT('main.chat.truncated', request.settings.language, { reason, advice: tokenAdvice })
}

function canOpenExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

function loadRenderer(window: BrowserWindow, hash?: string): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = hash ? `${process.env.ELECTRON_RENDERER_URL}#${hash}` : process.env.ELECTRON_RENDERER_URL
    void window.loadURL(url)
  } else {
    if (hash) {
      void window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
    } else {
      void window.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }
}

function registerExternalLinkHandler(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (canOpenExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

function registerDataResourceProtocol(): void {
  protocol.handle(getDataResourceProtocol(), (request) => {
    const filePath = getDataResourceFilePathFromUrl(request.url)
    if (!filePath) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function showExistingInstance(): void {
  writeMainLog('Second instance requested; showing existing main window.')
  createWindow()
}

function showMainWindowForDeepLink(link: GllmDeepLink, origin: string): void {
  const source = link.source ? `, source=${link.source}` : ''
  const requestedTheme = link.theme ? `, theme=${link.theme}` : ''
  writeMainLog(`Accepted G-LLM deep link from ${origin}: action=${link.action}${source}${requestedTheme}.`)

  let deepLinkSettings: AppSettings | undefined
  if (link.theme === 'gold') {
    deepLinkSettings = setSettings({ ...getSettings(), theme: 'gold' })
  }

  const window = createWindow()
  if (deepLinkSettings) broadcastSettingsChange(deepLinkSettings)
  if (process.platform === 'darwin') app.focus({ steal: true })
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (link.handoffCode) void importGllmHandoff(link.handoffCode)
}

function receiveDeepLink(url: string, origin: string): void {
  const link = parseGllmDeepLink(url)
  if (!link) {
    // Never include the raw rejected URL in logs; it may contain credentials
    // even though the public contract explicitly forbids them.
    writeMainLog(`Rejected invalid G-LLM deep link from ${origin}.`)
    return
  }

  if (!isMainProcessReady) {
    pendingDeepLink = link
    return
  }

  showMainWindowForDeepLink(link, origin)
}

function registerGllmDeepLinkProtocol(): void {
  let registered = false

  if (process.defaultApp) {
    const appEntry = process.argv[1]
    if (!appEntry) {
      writeMainLog('Skipped development G-LLM protocol registration: Electron app entry was not available.')
      return
    }
    registered = app.setAsDefaultProtocolClient(GLLM_DEEP_LINK_SCHEME, process.execPath, [resolve(appEntry)])
  } else {
    registered = app.setAsDefaultProtocolClient(GLLM_DEEP_LINK_SCHEME)
  }

  writeMainLog(`G-LLM protocol registration ${registered ? 'succeeded' : 'failed'}.`)
}

function setupLinuxAppImageDeepLinkProtocol(): void {
  if (process.platform !== 'linux' || !process.env.APPIMAGE) return

  try {
    const applicationsDirectory = join(app.getPath('home'), '.local', 'share', 'applications')
    const desktopFile = join(applicationsDirectory, 'g-llm-client-url-handler.desktop')
    const appImagePath = resolve(process.env.APPIMAGE)
    const escapedAppImagePath = appImagePath
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('$', '\\$')
      .replaceAll('`', '\\`')

    mkdirSync(applicationsDirectory, { recursive: true })
    writeFileSync(
      desktopFile,
      `[Desktop Entry]\nName=G-LLM Client\nExec="${escapedAppImagePath}" %U\nTerminal=false\nType=Application\nMimeType=x-scheme-handler/${GLLM_DEEP_LINK_SCHEME};\nNoDisplay=true\n`,
      { encoding: 'utf8', mode: 0o644 }
    )
    execFile('update-desktop-database', [applicationsDirectory], (error) => {
      if (error) writeMainLog('Failed to refresh Linux desktop protocol database.', error)
    })
  } catch (error) {
    writeMainLog('Failed to install Linux AppImage protocol handler.', error)
  }
}

async function importGllmHandoff(code: string): Promise<void> {
  const digest = createHash('sha256').update(code).digest('hex')
  if (processedHandoffDigests.has(digest)) return
  processedHandoffDigests.add(digest)

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 10_000)
  try {
    const endpoint = resolveGllmHandoffExchangeUrl(is.dev, process.env.GLLM_HANDOFF_EXCHANGE_URL)
    const { apiKey } = await exchangeGllmHandoff(code, {
      endpoint,
      request: (url, init) => net.fetch(url, init),
      signal: abortController.signal
    })
    const currentProvider = getProviders().find((provider) => provider.id === DEFAULT_PROVIDER_ID)
    const savedProvider = saveProvider({
      ...DEFAULT_PROVIDER,
      ...currentProvider,
      id: DEFAULT_PROVIDER_ID,
      templateId: 'gllm',
      name: DEFAULT_PROVIDER.name,
      apiBaseUrl: DEFAULT_PROVIDER.apiBaseUrl,
      apiKey,
      updatedAt: Date.now()
    })
    const savedSettings = setSettings({ ...getSettings(), activeProviderId: DEFAULT_PROVIDER_ID })
    broadcastProvidersChange(getProviders())
    broadcastSettingsChange(savedSettings)
    broadcastDeepLinkHandoffStatus('success')
    writeMainLog(`Imported API key from one-time G-LLM handoff into provider=${savedProvider.id}.`)
  } catch (error) {
    broadcastDeepLinkHandoffStatus('error')
    writeMainLog('Failed to exchange one-time G-LLM handoff.', error)
  } finally {
    clearTimeout(timeout)
  }
}

function getWindowBackgroundColor(settings: Pick<AppSettings, 'theme'>): string {
  if (settings.theme === 'dark') return '#0f172a'
  if (settings.theme === 'gold') return '#1c1008'
  if (settings.theme === 'auto' && nativeTheme.shouldUseDarkColors) return '#0f172a'
  return '#f4f7f6'
}

function getTitleBarOverlay(settings: Pick<AppSettings, 'theme'>): { color: string; symbolColor: string; height: number } {
  const effectiveTheme = settings.theme === 'auto'
    ? nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    : settings.theme

  if (effectiveTheme === 'gold') {
    return { color: '#1c1008', symbolColor: '#f7d774', height: 44 }
  }
  if (effectiveTheme === 'dark') {
    return { color: '#0b1220', symbolColor: '#f8fafc', height: 44 }
  }
  return { color: '#f8fafc', symbolColor: '#0f172a', height: 44 }
}

function applyNativeWindowColors(settings: Pick<AppSettings, 'theme'>): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setBackgroundColor(getWindowBackgroundColor(settings))
  if (process.platform === 'win32') mainWindow.setTitleBarOverlay(getTitleBarOverlay(settings))
}

function syncNativeTheme(settings: Pick<AppSettings, 'theme'>): void {
  nativeTheme.themeSource = settings.theme === 'auto'
    ? 'system'
    : settings.theme === 'light'
      ? 'light'
      : 'dark'

  applyNativeWindowColors(settings)
}

function createWindow(): BrowserWindow {
  quickWindowShowPending = false
  quickWindow?.hide()
  mainHiddenMode = 'none'

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (process.platform === 'darwin') app.focus({ steal: true })
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    hideFloatingLogo()
    return mainWindow
  }

  const settings = getSettings()
  syncNativeTheme(settings)

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    title: mainT('about.productName', settings.language),
    backgroundColor: getWindowBackgroundColor(settings),
    autoHideMenuBar: true,
    skipTaskbar: false,
    icon: getAppIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : process.platform === 'win32' ? 'hidden' : 'default',
    titleBarOverlay: process.platform === 'win32' ? getTitleBarOverlay(settings) : undefined,
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 10 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.setMenu(null)
  mainWindow.setMenuBarVisibility(false)
  mainWindow.setSkipTaskbar(false)
  mainWindow.on('move', () => {
    if (mainWindow && !mainWindow.isMinimized()) lastMainWindowBounds = mainWindow.getBounds()
  })
  mainWindow.on('resize', () => {
    if (mainWindow && !mainWindow.isMinimized()) lastMainWindowBounds = mainWindow.getBounds()
  })
  mainWindow.on('minimize', () => {
    if (process.platform !== 'win32' || isQuitting) return

    if (mainWindow) lastMainWindowBounds = mainWindow.getNormalBounds()
    const mascotVisible = getSettings().floatingMascotVisible
    mainHiddenMode = mascotVisible ? 'floating' : 'tray'
    mainWindow?.hide()
    quickWindow?.hide()
    if (mascotVisible) showFloatingLogo()
    else hideFloatingLogo()
  })
  mainWindow.on('close', (event) => {
    if (process.platform !== 'win32' || isQuitting) return

    event.preventDefault()
    if (mainWindow) lastMainWindowBounds = mainWindow.getNormalBounds()
    const mascotVisible = getSettings().floatingMascotVisible
    mainHiddenMode = mascotVisible ? 'floating' : 'tray'
    mainWindow?.hide()
    quickWindow?.hide()
    if (mascotVisible) showFloatingLogo()
    else hideFloatingLogo()
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    showFloatingLogo()
  })

  registerExternalLinkHandler(mainWindow)
  loadRenderer(mainWindow)
  lastMainWindowBounds = mainWindow.getBounds()
  if (process.platform === 'darwin') app.focus({ steal: true })
  return mainWindow
}

function showMainWindowForConversation(requestValue?: unknown): void {
  const window = createWindow()
  const request = normalizeMainConversationOpenRequest(requestValue)
  if (!request) return

  const notify = () => {
    if (!window.isDestroyed()) window.webContents.send('conversation:open-in-main', request)
  }
  if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', notify)
  else notify()
}

function getFloatingLogoBounds(): Rectangle {
  if (floatingLogoBounds) {
    floatingLogoBounds = normalizeFloatingLogoBounds(floatingLogoBounds)
    return floatingLogoBounds
  }

  const display =
    lastMainWindowBounds
      ? screen.getDisplayMatching(lastMainWindowBounds)
      : mainWindow && !mainWindow.isDestroyed()
        ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay()
  const workArea = display.workArea
  const size = getAdaptiveFloatingLogoSize(display)

  return {
    x: workArea.x + workArea.width - size - 20,
    y: workArea.y + workArea.height - size - 20,
    width: size,
    height: size
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function getFloatingLogoDisplay(bounds: Rectangle): Electron.Display {
  return screen.getDisplayNearestPoint({
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  })
}

function getAdaptiveFloatingLogoSize(display: Electron.Display): number {
  const physicalWidth = display.workArea.width * display.scaleFactor
  const physicalHeight = display.workArea.height * display.scaleFactor
  const resolutionScale = Math.sqrt((physicalWidth * physicalHeight) / (1920 * 1080))
  return Math.round(clamp(
    FLOATING_LOGO_BASE_SIZE * resolutionScale,
    FLOATING_LOGO_MIN_SIZE,
    FLOATING_LOGO_MAX_SIZE
  ))
}

function normalizeFloatingLogoBounds(bounds: Rectangle): Rectangle {
  const display = getFloatingLogoDisplay(bounds)
  const workArea = display.workArea
  const width = getAdaptiveFloatingLogoSize(display)
  const height = width

  return {
    x: clamp(bounds.x, workArea.x + FLOATING_LOGO_EDGE_GAP, workArea.x + workArea.width - width - FLOATING_LOGO_EDGE_GAP),
    y: clamp(bounds.y, workArea.y + FLOATING_LOGO_EDGE_GAP, workArea.y + workArea.height - height - FLOATING_LOGO_EDGE_GAP),
    width,
    height
  }
}

function getFloatingMascotHintBounds(logoBounds: Rectangle): { bounds: Rectangle; placement: 'left' | 'right' } {
  const display = getFloatingLogoDisplay(logoBounds)
  const workArea = display.workArea
  const hasRoomOnLeft = logoBounds.x - FLOATING_HINT_GAP - FLOATING_HINT_WIDTH >= workArea.x + FLOATING_LOGO_EDGE_GAP
  const placement = hasRoomOnLeft ? 'left' : 'right'
  const preferredX = placement === 'left'
    ? logoBounds.x - FLOATING_HINT_GAP - FLOATING_HINT_WIDTH
    : logoBounds.x + logoBounds.width + FLOATING_HINT_GAP
  const x = clamp(
    preferredX,
    workArea.x + FLOATING_LOGO_EDGE_GAP,
    workArea.x + workArea.width - FLOATING_HINT_WIDTH - FLOATING_LOGO_EDGE_GAP
  )
  const y = clamp(
    Math.round(logoBounds.y + (logoBounds.height - FLOATING_HINT_HEIGHT) / 2),
    workArea.y + FLOATING_LOGO_EDGE_GAP,
    workArea.y + workArea.height - FLOATING_HINT_HEIGHT - FLOATING_LOGO_EDGE_GAP
  )

  return {
    bounds: { x, y, width: FLOATING_HINT_WIDTH, height: FLOATING_HINT_HEIGHT },
    placement
  }
}

function sendFloatingMascotHint(): void {
  if (!currentFloatingMascotHint || !floatingMascotHintWindow || floatingMascotHintWindow.isDestroyed()) return
  floatingMascotHintWindow.webContents.send('floating-mascot:hint', currentFloatingMascotHint)
}

function positionFloatingMascotHint(): void {
  if (!floatingMascotHintWindow || floatingMascotHintWindow.isDestroyed()) return
  const logoBounds = floatingLogoBounds ?? floatingLogoWindow?.getBounds()
  if (!logoBounds) return
  const { bounds, placement } = getFloatingMascotHintBounds(logoBounds)
  floatingMascotHintWindow.setBounds(bounds, false)
  if (currentFloatingMascotHint && currentFloatingMascotHint.placement !== placement) {
    currentFloatingMascotHint = { ...currentFloatingMascotHint, placement }
    sendFloatingMascotHint()
  }
}

function snapFloatingLogoBounds(bounds: Rectangle): Rectangle {
  const normalized = normalizeFloatingLogoBounds(bounds)
  const display = getFloatingLogoDisplay(normalized)
  const workArea = display.workArea
  const distances = [
    { edge: 'left', value: Math.abs(normalized.x - workArea.x) },
    { edge: 'right', value: Math.abs(workArea.x + workArea.width - (normalized.x + normalized.width)) },
    { edge: 'top', value: Math.abs(normalized.y - workArea.y) },
    { edge: 'bottom', value: Math.abs(workArea.y + workArea.height - (normalized.y + normalized.height)) }
  ].sort((a, b) => a.value - b.value)
  const snapped = { ...normalized }

  switch (distances[0]?.edge) {
    case 'left':
      snapped.x = workArea.x + FLOATING_LOGO_EDGE_GAP
      break
    case 'right':
      snapped.x = workArea.x + workArea.width - snapped.width - FLOATING_LOGO_EDGE_GAP
      break
    case 'top':
      snapped.y = workArea.y + FLOATING_LOGO_EDGE_GAP
      break
    case 'bottom':
      snapped.y = workArea.y + workArea.height - snapped.height - FLOATING_LOGO_EDGE_GAP
      break
  }

  return snapped
}

function setFloatingLogoBounds(bounds: Rectangle): void {
  floatingLogoBounds = normalizeFloatingLogoBounds(bounds)
  if (floatingLogoWindow && !floatingLogoWindow.isDestroyed()) {
    floatingLogoWindow.setBounds(floatingLogoBounds, false)
  }
  if (floatingMascotHintWindow?.isVisible()) positionFloatingMascotHint()
}

function beginFloatingLogoDrag(): void {
  if (!floatingLogoWindow || floatingLogoWindow.isDestroyed()) return

  hideFloatingMascotHint()
  const cursor = screen.getCursorScreenPoint()
  const bounds = floatingLogoWindow.getBounds()
  floatingLogoDragOffset = {
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y
  }
}

function moveFloatingLogoDrag(): void {
  if (!floatingLogoDragOffset || !floatingLogoWindow || floatingLogoWindow.isDestroyed()) return

  const cursor = screen.getCursorScreenPoint()
  setFloatingLogoBounds({
    x: cursor.x - floatingLogoDragOffset.x,
    y: cursor.y - floatingLogoDragOffset.y,
    width: floatingLogoWindow.getBounds().width,
    height: floatingLogoWindow.getBounds().height
  })
}

function endFloatingLogoDrag(): void {
  if (!floatingLogoWindow || floatingLogoWindow.isDestroyed()) {
    floatingLogoDragOffset = null
    return
  }

  const currentBounds = floatingLogoBounds ?? floatingLogoWindow.getBounds()
  floatingLogoDragOffset = null
  setFloatingLogoBounds(snapFloatingLogoBounds(currentBounds))
}

function createFloatingLogoWindow(): BrowserWindow {
  if (floatingLogoWindow && !floatingLogoWindow.isDestroyed()) {
    floatingLogoWindow.setBounds(getFloatingLogoBounds(), false)
    return floatingLogoWindow
  }

  floatingLogoWindow = new BrowserWindow({
    ...getFloatingLogoBounds(),
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    transparent: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    acceptFirstMouse: process.platform === 'darwin',
    hiddenInMissionControl: process.platform === 'darwin',
    title: 'G-LLM',
    backgroundColor: '#00000000',
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  floatingLogoWindow.setMenu(null)
  floatingLogoWindow.setMenuBarVisibility(false)
  floatingLogoWindow.setAlwaysOnTop(true, 'floating')
  floatingLogoWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      floatingLogoWindow?.hide()
    }
  })
  floatingLogoWindow.on('closed', () => {
    floatingLogoWindow = null
  })

  registerExternalLinkHandler(floatingLogoWindow)
  loadRenderer(floatingLogoWindow, 'floating-logo')
  return floatingLogoWindow
}

function createFloatingMascotHintWindow(): BrowserWindow {
  if (floatingMascotHintWindow && !floatingMascotHintWindow.isDestroyed()) return floatingMascotHintWindow

  const { bounds } = getFloatingMascotHintBounds(getFloatingLogoBounds())
  floatingMascotHintWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    transparent: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    acceptFirstMouse: process.platform === 'darwin',
    hiddenInMissionControl: process.platform === 'darwin',
    title: 'G-LLM',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  floatingMascotHintWindow.setMenu(null)
  floatingMascotHintWindow.setMenuBarVisibility(false)
  floatingMascotHintWindow.setAlwaysOnTop(true, 'floating')
  floatingMascotHintWindow.setIgnoreMouseEvents(true, { forward: true })
  floatingMascotHintWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      floatingMascotHintWindow?.hide()
    }
  })
  floatingMascotHintWindow.on('closed', () => {
    floatingMascotHintWindow = null
  })

  registerExternalLinkHandler(floatingMascotHintWindow)
  loadRenderer(floatingMascotHintWindow, 'floating-hint')
  return floatingMascotHintWindow
}

function hideFloatingMascotHint(): void {
  if (floatingMascotHintHideTimer) {
    clearTimeout(floatingMascotHintHideTimer)
    floatingMascotHintHideTimer = null
  }
  currentFloatingMascotHint = null
  floatingMascotHintWindow?.hide()
}

function clearFloatingMascotHintSchedule(): void {
  if (!floatingMascotHintTimer) return
  clearTimeout(floatingMascotHintTimer)
  floatingMascotHintTimer = null
}

function showFloatingMascotHint(
  message: string,
  tone: FloatingMascotHintEvent['tone'] = 'idle',
  duration = 6500
): void {
  if (!getSettings().floatingMascotHints || !floatingLogoWindow?.isVisible()) return

  const hintWindow = createFloatingMascotHintWindow()
  const { bounds, placement } = getFloatingMascotHintBounds(floatingLogoBounds ?? floatingLogoWindow.getBounds())
  currentFloatingMascotHint = { message, placement, tone }
  hintWindow.setBounds(bounds, false)
  hintWindow.setAlwaysOnTop(true, 'floating')
  hintWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  hintWindow.showInactive()
  hintWindow.moveTop()
  if (hintWindow.webContents.isLoading()) {
    hintWindow.webContents.once('did-finish-load', sendFloatingMascotHint)
  } else {
    sendFloatingMascotHint()
  }

  if (floatingMascotHintHideTimer) clearTimeout(floatingMascotHintHideTimer)
  floatingMascotHintHideTimer = setTimeout(hideFloatingMascotHint, duration)
}

const floatingMascotIdleHintKeys = [
  'main.floating.idle1',
  'main.floating.idle2',
  'main.floating.idle3',
  'main.floating.idle4',
  'main.floating.idle5'
]

function scheduleFloatingMascotHint(initial = false): void {
  clearFloatingMascotHintSchedule()
  if (!getSettings().floatingMascotHints || !floatingLogoWindow?.isVisible()) return

  const delay = initial ? 9000 : 52000 + Math.round(Math.random() * 36000)
  floatingMascotHintTimer = setTimeout(() => {
    const key = floatingMascotIdleHintKeys[floatingMascotHintIndex % floatingMascotIdleHintKeys.length]
    const message = mainT(key, getSettings().language)
    floatingMascotHintIndex += 1
    showFloatingMascotHint(message)
    scheduleFloatingMascotHint(false)
  }, delay)
}

function revealFloatingLogoWindow(window: BrowserWindow): void {
  window.setBounds(getFloatingLogoBounds(), false)
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.showInactive()
  window.moveTop()
  scheduleFloatingMascotHint(true)
  if (pendingFloatingMascotHint) {
    const hint = pendingFloatingMascotHint
    pendingFloatingMascotHint = null
    setTimeout(() => showFloatingMascotHint(hint.message, hint.tone, 7600), 350)
  }
}

function shouldRevealFloatingLogo(): boolean {
  return Boolean(
    getSettings().floatingMascotVisible &&
    (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) &&
    !quickWindowShowPending &&
    (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible())
  )
}

function showFloatingLogo(): void {
  if (!supportsFloatingMascot || isQuitting || !shouldRevealFloatingLogo()) return

  const window = createFloatingLogoWindow()
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => {
      if (!window.isDestroyed() && shouldRevealFloatingLogo()) {
        revealFloatingLogoWindow(window)
      }
    })
    return
  }

  revealFloatingLogoWindow(window)
}

function hideFloatingLogo(): void {
  clearFloatingMascotHintSchedule()
  hideFloatingMascotHint()
  if (floatingLogoWindow && !floatingLogoWindow.isDestroyed()) {
    floatingLogoWindow.hide()
  }
}

function hideFloatingLogoToTray(): void {
  if (mainHiddenMode === 'floating') mainHiddenMode = 'tray'
  const saved = setSettings({ ...getSettings(), floatingMascotVisible: false })
  hideFloatingLogo()
  broadcastSettingsChange(saved)
}

function showFloatingLogoFromTray(): void {
  if (!supportsFloatingMascot) return

  if (mainHiddenMode === 'tray' && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())) {
    mainHiddenMode = 'floating'
  }
  const saved = setSettings({ ...getSettings(), floatingMascotVisible: true })
  broadcastSettingsChange(saved)
  showFloatingLogo()
}

function getQuickWindowBounds(anchorBounds?: Rectangle): Rectangle {
  const width = 760
  const height = 680
  const display = anchorBounds
    ? screen.getDisplayNearestPoint({
        x: Math.round(anchorBounds.x + anchorBounds.width / 2),
        y: Math.round(anchorBounds.y + anchorBounds.height / 2)
      })
    : screen.getPrimaryDisplay()
  const workArea = display.workArea
  const preferredX = anchorBounds ? Math.round(anchorBounds.x + anchorBounds.width / 2 - width / 2) : Math.round(workArea.x + (workArea.width - width) / 2)
  const x = Math.min(Math.max(preferredX, workArea.x + 10), workArea.x + workArea.width - width - 10)
  const y = anchorBounds ? Math.min(anchorBounds.y + anchorBounds.height + 8, workArea.y + workArea.height - height - 10) : Math.round(workArea.y + 40)

  return {
    x,
    y: Math.max(y, workArea.y + 8),
    width,
    height
  }
}

function createQuickWindow(anchorBounds?: Rectangle): BrowserWindow {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.setBounds(getQuickWindowBounds(anchorBounds), false)
    return quickWindow
  }

  quickWindowReady = false
  quickWindow = new BrowserWindow({
    ...getQuickWindowBounds(anchorBounds),
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: process.platform !== 'win32',
    transparent: true,
    title: mainT('quickChat.title', getSettings().language),
    backgroundColor: '#00000000',
    icon: getAppIconPath(),
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  quickWindow.setMenu(null)
  quickWindow.setMenuBarVisibility(false)
  quickWindow.setAlwaysOnTop(true, 'floating')
  quickWindow.webContents.on('did-start-navigation', () => {
    quickWindowReady = false
    if (quickWindow?.isVisible()) {
      quickWindowShowPending = true
      quickWindow.hide()
    }
  })
  quickWindow.webContents.on('did-finish-load', () => {
    quickWindowReady = true
    if (!quickWindowShowPending || !quickWindow || quickWindow.isDestroyed()) return
    quickWindowShowPending = false
    quickWindow.show()
    quickWindow.focus()
  })
  quickWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      hideQuickWindow()
    }
  })
  quickWindow.on('closed', () => {
    quickWindow = null
    quickWindowReady = false
    quickWindowShowPending = false
  })

  registerExternalLinkHandler(quickWindow)
  loadRenderer(quickWindow, `quick?theme=${encodeURIComponent(getSettings().theme)}`)
  return quickWindow
}

function showQuickWindow(anchorBounds?: Rectangle): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide()
  }
  hideFloatingLogo()

  const window = createQuickWindow(anchorBounds)
  window.setBounds(getQuickWindowBounds(anchorBounds), false)
  quickWindowShowPending = true
  if (quickWindowReady) {
    quickWindowShowPending = false
    window.show()
    window.focus()
  }
}

function hideQuickWindow(): void {
  quickWindowShowPending = false
  quickWindow?.hide()
  showFloatingLogo()
}

function resolveFloatingMascotSkin(settings: Pick<AppSettings, 'theme' | 'floatingMascotSkin'>): FloatingMascotSkin {
  if (settings.floatingMascotSkin === 'blue' || settings.floatingMascotSkin === 'gold') {
    return settings.floatingMascotSkin
  }
  return settings.theme === 'gold' ? 'gold' : 'blue'
}

function broadcastFloatingMascotSkin(settings: AppSettings): void {
  if (floatingLogoWindow && !floatingLogoWindow.isDestroyed()) {
    floatingLogoWindow.webContents.send('floating-mascot:skin-changed', resolveFloatingMascotSkin(settings))
  }
}

function setFloatingMascotAppearance(appearance: FloatingMascotAppearance): void {
  const saved = setSettings({ ...getSettings(), floatingMascotSkin: appearance })
  broadcastSettingsChange(saved)
  broadcastFloatingMascotSkin(saved)
}

function setFloatingMascotHints(enabled: boolean): void {
  const saved = setSettings({ ...getSettings(), floatingMascotHints: enabled })
  broadcastSettingsChange(saved)
  if (enabled) {
    scheduleFloatingMascotHint(true)
  } else {
    clearFloatingMascotHintSchedule()
    hideFloatingMascotHint()
  }
}

function setAppLanguage(language: AppSettings['language']): void {
  const saved = setSettings({ ...getSettings(), language })
  broadcastSettingsChange(saved)
}

function buildAppStatusMenu(anchorBounds?: Rectangle): Menu {
  const settings = getSettings()
  const floatingLogoEnabled = settings.floatingMascotVisible
  const t = (key: string) => mainT(key, settings.language)

  return Menu.buildFromTemplate([
    { label: t('native.openQuickChat'), click: () => showQuickWindow(anchorBounds) },
    { label: t('native.openMainWindow'), click: () => createWindow() },
    {
      label: t('native.language'),
      submenu: [
        {
          label: t('language.system'),
          type: 'radio' as const,
          checked: settings.language === 'system',
          click: () => setAppLanguage('system')
        },
        {
          label: t('language.zhCN'),
          type: 'radio' as const,
          checked: settings.language === 'zh-CN',
          click: () => setAppLanguage('zh-CN')
        },
        {
          label: t('language.enUS'),
          type: 'radio' as const,
          checked: settings.language === 'en-US',
          click: () => setAppLanguage('en-US')
        }
      ]
    },
    ...(supportsFloatingMascot
      ? [
          {
            label: t(floatingLogoEnabled ? 'native.hideFloating' : 'native.showFloating'),
            click: () => {
              if (floatingLogoEnabled) {
                hideFloatingLogoToTray()
              } else {
                showFloatingLogoFromTray()
              }
            }
          },
          {
            label: t('native.mascotAppearance'),
            submenu: [
              {
                label: t('native.appearanceAuto'),
                type: 'radio' as const,
                checked: settings.floatingMascotSkin === 'auto',
                click: () => setFloatingMascotAppearance('auto')
              },
              {
                label: t('native.appearanceBlue'),
                type: 'radio' as const,
                checked: settings.floatingMascotSkin === 'blue',
                click: () => setFloatingMascotAppearance('blue')
              },
              {
                label: t('native.appearanceGold'),
                type: 'radio' as const,
                checked: settings.floatingMascotSkin === 'gold',
                click: () => setFloatingMascotAppearance('gold')
              }
            ]
          },
          {
            label: t('native.showMascotHints'),
            type: 'checkbox' as const,
            checked: settings.floatingMascotHints,
            click: (menuItem) => setFloatingMascotHints(menuItem.checked)
          }
        ]
      : []),
    { type: 'separator' },
    {
      label: t('native.quit'),
      click: () => quitApp()
    }
  ])
}

function showFloatingLogoContextMenu(): void {
  if (!floatingLogoWindow || floatingLogoWindow.isDestroyed()) return

  buildAppStatusMenu(floatingLogoWindow.getBounds()).popup({ window: floatingLogoWindow })
}

function toggleQuickWindow(anchorBounds?: Rectangle): void {
  if (quickWindow?.isVisible() || quickWindowShowPending) {
    hideQuickWindow()
    return
  }

  showQuickWindow(anchorBounds)
}

function handleTrayClick(anchorBounds?: Rectangle): void {
  toggleQuickWindow(anchorBounds)
}

function windowsUsesDarkTaskbar(): boolean {
  if (process.platform !== 'win32') return false

  try {
    const result = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'],
      { encoding: 'utf8', windowsHide: true }
    )
    const value = result.match(/SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i)?.[1]
    if (value) return Number.parseInt(value, 16) === 0
  } catch {
    // Fall back to Electron's system theme when the registry value is unavailable.
  }

  return nativeTheme.shouldUseDarkColors
}

function createTrayIcon(_settings: Pick<AppSettings, 'theme'>) {
  const useDarkBackground = windowsUsesDarkTaskbar()
  const sourceIcon = nativeImage.createFromPath(getTrayIconPath(useDarkBackground))
  if (process.platform !== 'darwin') return sourceIcon

  const icon = sourceIcon.resize({ height: 19, quality: 'best' })
  icon.setTemplateImage(true)
  return icon
}

function setupTray(): void {
  if (!['darwin', 'win32'].includes(process.platform) || tray) return

  tray = new Tray(createTrayIcon(getSettings()))
  tray.setToolTip(mainT('quickChat.title', getSettings().language))
  tray.on('click', (_, bounds) => handleTrayClick(bounds))
  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildAppStatusMenu(tray.getBounds()))
  })
}

function quitApp(): void {
  isQuitting = true
  mainHiddenMode = 'none'
  app.quit()
}

function broadcastActiveAssistantChange(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('assistant:active-changed', activeAssistantId)
    }
  }
}

function broadcastSettingsChange(settings: AppSettings): void {
  syncNativeTheme(settings)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('settings:changed', settings)
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(mainT('about.productName', settings.language))
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.setTitle(mainT('quickChat.title', settings.language))
  if (tray) {
    tray.setToolTip(mainT('quickChat.title', settings.language))
    if (process.platform === 'win32') tray.setImage(createTrayIcon(settings))
  }
}

function broadcastProvidersChange(providers: ApiProvider[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('providers:changed', providers)
  }
}

function broadcastDeepLinkHandoffStatus(status: 'success' | 'error'): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    const notify = () => {
      if (!window.isDestroyed()) window.webContents.send('deep-link:handoff-status', { status })
    }
    if (window.webContents.isLoadingMainFrame()) window.webContents.once('did-finish-load', notify)
    else notify()
  }
}

function broadcastAppUpdateStatus(status: AppUpdateInfo): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('app:update-status', status)
  }
}

function broadcastConversationChange(
  conversationId: string,
  action: ConversationChangeEvent['action'],
  conversation?: Conversation
): void {
  const change: ConversationChangeEvent = action === 'deleted'
    ? { action, conversationId, conversations: getConversations() }
    : { action, conversationId, conversation }

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('conversation:changed', change)
    }
  }
}

function getAppStateSnapshot() {
  const activeProjectId = getActiveProjectId()

  return {
    appVersion: app.getVersion(),
    appBuildCode: getAppBuildCode(),
    dataLocation: getDataLocationInfo(),
    activeProjectId,
    projects: getProjects(),
    settings: getSettings(),
    providers: getProviders(),
    assistants: getAssistants(activeProjectId),
    conversations: getConversations(activeProjectId),
    notes: getNotes(activeProjectId),
    memories: getMemories(activeProjectId),
    tools: getTools(activeProjectId)
  }
}

async function captureScreenshotForWindow(owner: BrowserWindow | null): Promise<PreparedAttachment | null> {
  const shouldHideOwner = (process.platform === 'win32' || process.platform === 'darwin')
    && owner
    && !owner.isDestroyed()
    && owner.isVisible()

  if (shouldHideOwner) {
    owner.hide()
    await sleep(SCREENSHOT_WINDOW_HIDE_DELAY_MS)
  }

  try {
    const { captureScreenshot } = await import('./screenshot')
    return await captureScreenshot()
  } finally {
    if (shouldHideOwner && owner && !owner.isDestroyed()) {
      if (owner.isMinimized()) owner.restore()
      owner.show()
      owner.focus()
    }
  }
}

function copyImageDataUrlToClipboard(dataUrl: string): void {
  const image = nativeImage.createFromDataURL(dataUrl)
  if (image.isEmpty()) throw new Error('Invalid image data')

  clipboard.writeImage(image)
}

if (gotSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    const result = inspectGllmDeepLinkArguments(argv)
    redactGllmDeepLinkArguments(argv)
    if (result.kind === 'valid') {
      if (isMainProcessReady) showMainWindowForDeepLink(result.link, 'second-instance arguments')
      else pendingDeepLink = result.link
      return
    }
    if (result.kind === 'invalid') {
      writeMainLog('Rejected invalid G-LLM deep link from second-instance arguments.')
      return
    }

    if (isMainProcessReady) showExistingInstance()
  })
}

nativeTheme.on('updated', () => {
  const settings = getSettings()
  if (settings.theme === 'auto') applyNativeWindowColors(settings)
  if (process.platform === 'win32' && tray) tray.setImage(createTrayIcon(settings))
})

process.on('uncaughtException', (error) => {
  writeMainLog('Uncaught exception', error)
})

process.on('unhandledRejection', (reason) => {
  writeMainLog('Unhandled rejection', reason)
})

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return

  electronApp.setAppUserModelId(APP_USER_MODEL_ID)
  Menu.setApplicationMenu(null)
  registerDataResourceProtocol()
  setupLinuxAppImageDeepLinkProtocol()

  const interruptedRuns = getAgentRunLedger().recoverInterruptedRuns()
  if (interruptedRuns.length > 0) {
    writeMainLog(`Recovered ${interruptedRuns.length} interrupted agent run(s) from the previous app session.`)
  }

  if (startupDeepLinkResult.kind === 'invalid') {
    writeMainLog('Rejected invalid G-LLM deep link from startup arguments.')
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('render-process-gone', (_, webContents, details) => {
    writeMainLog(`Render process gone: reason=${details.reason}, exitCode=${details.exitCode}, url=${webContents.getURL()}`)
  })

  app.on('child-process-gone', (_, details) => {
    writeMainLog(`Child process gone: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}`)
  })

  autoUpdateManager = new AutoUpdateManager({
    getLanguage: () => getSettings().language,
    onStatus: broadcastAppUpdateStatus,
    beforeInstall: () => {
      isQuitting = true
      mainHiddenMode = 'none'
    },
    log: writeMainLog
  })

  ipcMain.handle('app:get-state', () => getAppStateSnapshot())
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('app:get-update-state', () => autoUpdateManager?.getState())
  ipcMain.handle('app:check-for-updates', () => autoUpdateManager?.checkForUpdates())
  ipcMain.handle('app:download-update', () => autoUpdateManager?.downloadUpdate())
  ipcMain.handle('app:install-update', () => autoUpdateManager?.installUpdate() ?? false)
  ipcMain.handle('app:open-download-page', async () => {
    await shell.openExternal(DOWNLOAD_PAGE_URL)
  })
  ipcMain.handle('app:open-legal-document', async (_event, document: unknown) => {
    if (!isLegalDocument(document)) throw new Error('Unsupported legal document')
    const result = await shell.openPath(getLegalDocumentPath(document))
    if (result) throw new Error(result)
  })

  ipcMain.handle('storage:get-data-location', () => getDataLocationInfo())
  ipcMain.handle('storage:open-data-directory', async () => {
    const result = await shell.openPath(getDataLocationInfo().activePath)
    if (result) throw new Error(result)
  })
  ipcMain.handle('app:open-log-directory', async () => {
    const logDirectory = getMainLogDirectory()
    mkdirSync(logDirectory, { recursive: true })
    const result = await shell.openPath(logDirectory)
    if (result) throw new Error(result)
  })
  ipcMain.handle('app:export-diagnostics', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const language = getSettings().language
    const options: Electron.SaveDialogOptions = {
      title: mainT('native.exportDiagnostics', language),
      buttonLabel: mainT('native.exportDiagnosticsButton', language),
      defaultPath: `G-LLM-Diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [
        { name: mainT('native.diagnosticReport', language), extensions: ['json'] }
      ]
    }
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    exportDiagnosticReport(result.filePath)
    return result.filePath
  })
  ipcMain.handle('storage:choose-data-directory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const language = getSettings().language
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: mainT('native.chooseDataDirectory', language),
          buttonLabel: mainT('native.chooseDirectory', language),
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({
          title: mainT('native.chooseDataDirectory', language),
          buttonLabel: mainT('native.chooseDirectory', language),
          properties: ['openDirectory', 'createDirectory']
        })

    if (result.canceled || !result.filePaths[0]) return null
    return migrateDataRoot(result.filePaths[0])
  })
  ipcMain.handle('storage:choose-existing-data-directory', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const language = getSettings().language
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: mainT('native.chooseExistingDataDirectory', language),
          buttonLabel: mainT('native.useDirectory', language),
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: mainT('native.chooseExistingDataDirectory', language),
          buttonLabel: mainT('native.useDirectory', language),
          properties: ['openDirectory']
        })

    if (result.canceled || !result.filePaths[0]) return null
    return adoptExistingDataRoot(result.filePaths[0])
  })
  ipcMain.handle('storage:reset-data-directory', () => resetDataRoot())
  ipcMain.handle('storage:export-data-archive', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const language = getSettings().language
    const result = owner
      ? await dialog.showSaveDialog(owner, {
          title: mainT('native.exportData', language),
          defaultPath: `G-LLM-Data-${formatBuildCode(new Date())}.zip`,
          filters: [{ name: mainT('native.zipArchive', language), extensions: ['zip'] }]
        })
      : await dialog.showSaveDialog({
          title: mainT('native.exportData', language),
          defaultPath: `G-LLM-Data-${formatBuildCode(new Date())}.zip`,
          filters: [{ name: mainT('native.zipArchive', language), extensions: ['zip'] }]
        })

    if (result.canceled || !result.filePath) return null
    return exportDataArchive(result.filePath)
  })
  ipcMain.handle('storage:import-data-archive', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const language = getSettings().language
    const result = owner
      ? await dialog.showOpenDialog(owner, {
          title: mainT('native.importData', language),
          buttonLabel: mainT('native.importDataButton', language),
          filters: [{ name: mainT('native.zipArchive', language), extensions: ['zip'] }],
          properties: ['openFile']
        })
      : await dialog.showOpenDialog({
          title: mainT('native.importData', language),
          buttonLabel: mainT('native.importDataButton', language),
          filters: [{ name: mainT('native.zipArchive', language), extensions: ['zip'] }],
          properties: ['openFile']
        })

    if (result.canceled || !result.filePaths[0]) return null
    return importDataArchive(result.filePaths[0])
  })
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })
  ipcMain.handle('app:quit', () => {
    quitApp()
  })
  ipcMain.handle('app:show-main-window', (_, request?: MainConversationOpenRequest) => {
    showMainWindowForConversation(request)
  })
  ipcMain.handle('app:show-quick-panel', () => {
    showQuickWindow(floatingLogoWindow?.getBounds())
  })
  ipcMain.handle('app:hide-quick-panel', () => {
    hideQuickWindow()
  })
  ipcMain.handle('app:show-floating-logo-menu', () => {
    showFloatingLogoContextMenu()
  })
  ipcMain.handle('app:get-floating-mascot-skin', () => resolveFloatingMascotSkin(getSettings()))
  ipcMain.handle('app:get-floating-mascot-hint', () => currentFloatingMascotHint)
  ipcMain.on('app:floating-logo-drag-start', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) === floatingLogoWindow) beginFloatingLogoDrag()
  })
  ipcMain.on('app:floating-logo-drag-move', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) === floatingLogoWindow) moveFloatingLogoDrag()
  })
  ipcMain.on('app:floating-logo-drag-end', (event) => {
    if (BrowserWindow.fromWebContents(event.sender) === floatingLogoWindow) endFloatingLogoDrag()
  })
  ipcMain.handle('assistant:get-active', () => activeAssistantId)
  ipcMain.handle('assistant:set-active', (_, id: string) => {
    const nextId = id.trim()
    if (!nextId || nextId === activeAssistantId) return activeAssistantId

    activeAssistantId = nextId
    broadcastActiveAssistantChange()
    return activeAssistantId
  })

  ipcMain.handle('project:set-active', (_, id: string) => {
    setActiveProjectId(id)
    return getAppStateSnapshot()
  })
  ipcMain.handle('project:save', (_, project) => {
    const saved = saveProject(project)
    return {
      saved,
      state: getAppStateSnapshot()
    }
  })
  ipcMain.handle('project:delete', (_, id: string) => {
    deleteProject(id)
    return getAppStateSnapshot()
  })

  ipcMain.handle('settings:save', async (_, settings) => {
    const previous = getSettings()
    if (previous.telemetryEnabled && !settings.telemetryEnabled) {
      await trackTelemetryEvent('telemetry_disabled')
    }

    const saved = setSettings(settings)
    broadcastSettingsChange(saved)
    broadcastFloatingMascotSkin(saved)

    if (!previous.telemetryEnabled && saved.telemetryEnabled) {
      await trackTelemetryEvent('telemetry_enabled')
    }

    return saved
  })
  ipcMain.handle('provider:save', async (_, provider) => {
    const isNewProvider = !getProviders().some((item) => item.id === provider.id)
    const normalizedProvider = isOfficialGllmApiProvider(provider) && provider.modelsUpdatedAt
      ? { ...provider, defaultModel: resolveProviderModelId(provider, provider.defaultModel) }
      : provider
    const saved = saveProvider(normalizedProvider)
    broadcastProvidersChange(getProviders())
    void trackTelemetryEvent(isNewProvider ? 'provider_added' : 'provider_updated', getProviderTelemetryProperties(saved))
    return saved
  })
  ipcMain.handle('provider:delete', (_, id: string) => deleteProvider(id))
  ipcMain.handle('provider:check', (_, provider) => checkProviderConnection(provider, getSettings().language))
  ipcMain.handle('provider:check-theme-entitlement', () => getGoldThemeEntitlement())
  ipcMain.handle('provider:refresh-models', async (_, provider) => {
    try {
      const models = await fetchProviderModels(provider, getSettings().language)
      const refreshed = applyFetchedProviderModels(provider, models)
      void trackTelemetryEvent('provider_models_refreshed', getProviderTelemetryProperties(refreshed))
      return refreshed
    } catch (error) {
      void trackTelemetryEvent('provider_models_refresh_failed', {
        ...getProviderTelemetryProperties(provider),
        error_category: getErrorCategory(error)
      })
      throw error
    }
  })
  ipcMain.handle('assistant:save', (_, assistant) => saveAssistant(assistant))
  ipcMain.handle('assistant:reorder', (_, ids: string[]) => reorderAssistants(ids))
  ipcMain.handle('assistant:delete', (_, id: string) => {
    const assistant = getAssistants().find((item) => item.id === id)
    if (!assistant) return getAppStateSnapshot()
    const deletedConversationIds = getConversations()
      .filter((conversation) => conversation.assistantId === id)
      .map((conversation) => conversation.id)
    for (const conversationId of deletedConversationIds) cancelActiveResponse(conversationId)
    deleteAssistant(id)
    for (const conversationId of deletedConversationIds) {
      broadcastConversationChange(conversationId, 'deleted')
    }
    return getAppStateSnapshot()
  })
  ipcMain.handle('assistant:suggest', (_, request) => generateAssistantSuggestion(request))
  ipcMain.handle('conversation:search', (_, request) =>
    searchConversations(request, getConversationSearchSources())
  )
  ipcMain.handle('conversation:save', (_, conversation) => {
    const saved = saveConversation(conversation)
    broadcastConversationChange(saved.id, 'saved', saved)
    void maybeUpdateProjectMemory(saved)
    return saved
  })
  ipcMain.handle('conversation:set-pinned', (_, id: string, pinned: boolean) => {
    const conversation = getConversations().find((item) => item.id === id)
    if (!conversation) throw new Error('Conversation not found')
    const saved = saveConversation({
      ...conversation,
      pinnedAt: pinned ? Date.now() : undefined
    })
    broadcastConversationChange(saved.id, 'metadata', saved)
    return saved
  })
  ipcMain.handle('conversation:delete', (_, id: string) => {
    cancelActiveResponse(id)
    deleteConversation(id)
    broadcastConversationChange(id, 'deleted')
  })
  ipcMain.handle('note:save', (_, note) => saveNote(note))
  ipcMain.handle('note:delete', (_, id: string) => deleteNote(id))
  ipcMain.handle('memory:save', (_, memory) => saveMemory(memory))
  ipcMain.handle('memory:delete', (_, id: string) => deleteMemory(id))
  ipcMain.handle('tool:save', (_, tool) => saveTool(tool))
  ipcMain.handle('tool:delete', (_, id: string) => deleteTool(id))
  ipcMain.handle('attachment:pick', async (event, kind) => {
    const { pickAttachments } = await import('./attachments')
    return pickAttachments(BrowserWindow.fromWebContents(event.sender), kind, getSettings().language)
  })
  ipcMain.handle('attachment:prepare-pasted', async (_, inputs) => {
    const { preparePastedAttachments } = await import('./attachments')
    return preparePastedAttachments(inputs)
  })
  ipcMain.handle('local-task:prepare', async (_, request: string, attachmentIds: string[]) => {
    const { prepareLocalFileTask } = await import('./localFileTasks')
    return prepareLocalFileTask(request, attachmentIds, getSettings().language)
  })
  ipcMain.handle('local-task:execute', async (event, planId: string) => {
    const { executeLocalFileTask } = await import('./localFileTasks')
    return executeLocalFileTask(
      planId,
      (progress) => event.sender.send('local-task:progress', progress),
      getSettings().language
    )
  })
  ipcMain.handle('local-task:cancel', async (_, planId: string) => {
    const { cancelLocalFileTask } = await import('./localFileTasks')
    return cancelLocalFileTask(planId)
  })
  ipcMain.handle('local-task:open-output', async (_, planId: string) => {
    const { getLocalTaskOutputDirectory } = await import('./localFileTasks')
    const outputPath = getLocalTaskOutputDirectory(planId)
    if (!outputPath) throw new Error(mainT('main.localTask.outputExpired', getSettings().language))
    const error = await shell.openPath(outputPath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('project:choose-workspace', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: mainT('native.chooseWorkspace', getSettings().language),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.on('workspace-agent:approval-response', (event, id: string, approved: boolean) => {
    const pending = pendingWorkspaceApprovals.get(id)
    if (!pending || pending.senderId !== event.sender.id) return
    pending.resolve(Boolean(approved))
  })
  ipcMain.handle('workspace-agent:run', async (event, request: WorkspaceAgentRequest) => {
    const requestStartedAt = Date.now()
    const runLedger = getAgentRunLedger()
    const run = runLedger.start({
      kind: 'workspace',
      conversationId: request.conversationId,
      providerId: request.provider.id,
      modelId: request.provider.defaultModel,
      details: {
        messageCount: request.messages.length,
        webSearch: Boolean(request.webSearchEnabled),
        webSearchMode: request.webSearchMode ?? 'legacy'
      }
    })
    const activityStates = new Map<string, string>()
    const active = registerActiveResponse('workspace', request.conversationId)
    writeMainLog(
      `Workspace request started: conversation=${request.conversationId}, provider=${request.provider.id}, model=${request.provider.defaultModel}, messages=${request.messages.length}, webSearchMode=${request.webSearchMode ?? 'legacy'}, webSearch=${Boolean(request.webSearchEnabled)}.`
    )
    broadcastChatActivity({ conversationId: request.conversationId, active: true })
    try {
      const { runWorkspaceAgent } = await import('./workspaceAgent')
      const prepared = await prepareProviderRequestModel(request)
      const result = await runWorkspaceAgent(
        prepared.request,
        (progress) => {
          event.sender.send('workspace-agent:progress', progress)
          if (progress.activity.tool === 'model_request_retry') return
          const stateKey = `${progress.activity.status}:${progress.activity.detail ?? ''}`
          if (activityStates.get(progress.activity.id) === stateKey) return
          activityStates.set(progress.activity.id, stateKey)
          const type = progress.activity.status === 'running'
            ? 'tool_started'
            : progress.activity.status === 'completed'
              ? 'tool_completed'
              : 'tool_failed'
          runLedger.record(run.id, type, 'running_tool', {
            tool: progress.activity.tool,
            label: progress.activity.label
          })
        },
        async (approval) => {
          const id = randomUUID()
          const prompt: WorkspaceApprovalPrompt = { id, conversationId: request.conversationId, ...approval }
          runLedger.record(run.id, 'approval_waiting', 'waiting_approval', {
            tool: approval.tool,
            canWrite: approval.canWrite,
            isScript: approval.isScript
          })
          return await new Promise<boolean>((resolvePromise) => {
            const finish = (approved: boolean) => {
              pendingWorkspaceApprovals.delete(id)
              active.controller.signal.removeEventListener('abort', handleAbort)
              runLedger.record(run.id, 'approval_resolved', 'running_tool', { approved })
              resolvePromise(approved)
            }
            const handleAbort = () => finish(false)
            pendingWorkspaceApprovals.set(id, { senderId: event.sender.id, resolve: finish })
            active.controller.signal.addEventListener('abort', handleAbort, { once: true })
            event.sender.send('workspace-agent:approval-requested', prompt)
          })
        },
        active.controller.signal,
        (runtimeEvent) => runLedger.record(
          run.id,
          runtimeEvent.type,
          runtimeEvent.status,
          runtimeEvent.details
        )
      )
      if (isCurrentActiveResponse(active.key, active.controller)) {
        broadcastChatActivity({ conversationId: request.conversationId, active: false })
      }
      writeMainLog(
        `Workspace request completed: conversation=${request.conversationId}, durationMs=${Date.now() - requestStartedAt}, changedFiles=${result.changedFiles.length}.`
      )
      runLedger.record(run.id, 'run_succeeded', 'succeeded', {
        durationMs: Date.now() - requestStartedAt,
        changedFiles: result.changedFiles.length,
        savedCharacters: result.contextSavings?.savedCharacters ?? 0
      })
      return result
    } catch (error) {
      if (active.controller.signal.aborted) {
        const isCurrent = isCurrentActiveResponse(active.key, active.controller)
        if (isCurrent) {
          broadcastChatActivity({ conversationId: request.conversationId, active: false })
        }
        writeMainLog(
          `Workspace request ${isCurrent ? 'cancelled' : 'replaced'}: conversation=${request.conversationId}, durationMs=${Date.now() - requestStartedAt}.`
        )
        runLedger.record(run.id, 'run_stopped', 'stopped', {
          reason: isCurrent ? 'cancelled' : 'replaced',
          durationMs: Date.now() - requestStartedAt
        })
        throw new Error('任务已停止')
      }
      const message = error instanceof Error ? error.message : String(error)
      if (isCurrentActiveResponse(active.key, active.controller)) {
        broadcastChatActivity({ conversationId: request.conversationId, active: false, error: message })
      }
      writeMainLog(
        `Workspace request failed: conversation=${request.conversationId}, durationMs=${Date.now() - requestStartedAt}, category=${getErrorCategory(error)}.`,
        error
      )
      runLedger.record(run.id, 'run_failed', 'failed', {
        durationMs: Date.now() - requestStartedAt,
        errorCategory: getErrorCategory(error),
        error: message
      })
      throw error
    } finally {
      releaseActiveResponse(active.key, active.controller)
    }
  })
  ipcMain.handle('workspace:reveal-file', async (_, rootPath: string, relativePath: string) => {
    const { resolveWorkspaceItem } = await import('./workspaceAgent')
    const filePath = await resolveWorkspaceItem(rootPath, relativePath)
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('attachment:screenshot', (event) => captureScreenshotForWindow(BrowserWindow.fromWebContents(event.sender)))
  ipcMain.handle('clipboard:copy-image', (_, dataUrl: string) => copyImageDataUrlToClipboard(dataUrl))
  ipcMain.on('response:cancel', (_, conversationId: string) => cancelActiveResponse(conversationId))

  ipcMain.on('chat:stream', async (event, request) => {
    const requestStartedAt = Date.now()
    const requestKey = `${request.purpose ?? 'reply'}:${request.targetMessageId ?? 'main'}`
    const runLedger = getAgentRunLedger()
    const run = runLedger.start({
      kind: 'chat',
      conversationId: request.conversationId,
      requestKey,
      providerId: request.provider.id,
      modelId: request.provider.defaultModel,
      details: {
        messageCount: request.messages.length,
        purpose: request.purpose ?? 'chat',
        webSearch: Boolean(request.webSearchEnabled),
        webSearchMode: request.webSearchMode ?? 'legacy'
      }
    })
    runLedger.record(run.id, 'context_prepared', 'planning', {
      messages: request.messages.length
    })
    const active = registerActiveResponse(
      'chat',
      request.conversationId,
      requestKey
    )
    const chunkBase = {
      conversationId: request.conversationId,
      purpose: request.purpose,
      targetMessageId: request.targetMessageId
    }
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    let finishReason = ''
    let isTruncated = false
    let contextSavings: ContextSavings | undefined
    let effectiveRequest: ChatRequest = request
    let fallbackWarning = ''
    let modelAttempt = 0
    recordThemeRequestUsage(isOfficialGllmApiProvider(request.provider))
    writeMainLog(
      `Chat request started: conversation=${request.conversationId}, provider=${request.provider.id}, model=${request.provider.defaultModel}, messages=${request.messages.length}, webSearchMode=${request.webSearchMode ?? 'legacy'}, webSearch=${Boolean(request.webSearchEnabled)}, purpose=${request.purpose ?? 'chat'}.`
    )
    broadcastChatActivity({ conversationId: request.conversationId, active: true })

    try {
      const prepared = await prepareProviderRequestModel(request)
      effectiveRequest = prepared.request
      if (prepared.fallbackFrom) {
        fallbackWarning = mainT('main.provider.modelUnavailableFallback', request.settings.language, {
          model: prepared.fallbackFrom,
          fallback: effectiveRequest.provider.defaultModel
        })
      }

      void trackTelemetryEvent('chat_started', getChatTelemetryProperties(effectiveRequest))
      let modelFallbackRetried = false
      while (true) {
        try {
          modelAttempt += 1
          runLedger.record(run.id, 'model_request_started', 'running_model', {
            attempt: modelAttempt,
            model: effectiveRequest.provider.defaultModel
          })
          for await (const chunk of streamGllmChat(effectiveRequest, active.controller.signal, (diagnostic) => {
            writeMainLog(
              `Chat diagnostic: conversation=${request.conversationId}, stage=${diagnostic.stage}, outcome=${diagnostic.outcome}, details=${JSON.stringify(diagnostic.details ?? {})}.`
            )
          })) {
            if (chunk.usage) {
              inputTokens = chunk.usage.inputTokens
              outputTokens = chunk.usage.outputTokens
              totalTokens = chunk.usage.totalTokens
            }
            if (chunk.finishReason) finishReason = chunk.finishReason
            if (chunk.isTruncated) isTruncated = true
            if (chunk.contextSavings) contextSavings = chunk.contextSavings
            event.sender.send('chat:chunk', {
              ...chunkBase,
              content: chunk.content ?? '',
              reasoningContent: chunk.reasoningContent,
              usage: chunk.usage,
              webSearch: chunk.webSearch,
              finishReason: chunk.finishReason,
              isTruncated: chunk.isTruncated
            })
          }
          break
        } catch (error) {
          if (modelFallbackRetried || !isOfficialGllmApiProvider(effectiveRequest.provider) || !isModelNotFoundError(error)) {
            throw error
          }

          const failedModel = effectiveRequest.provider.defaultModel
          const refreshed = await prepareProviderRequestModel(effectiveRequest, true)
          if (refreshed.request.provider.defaultModel === failedModel) throw error

          effectiveRequest = refreshed.request
          modelFallbackRetried = true
          runLedger.record(run.id, 'model_retrying', 'retrying', {
            attempt: modelAttempt + 1,
            reason: 'model_unavailable',
            previousModel: failedModel,
            fallbackModel: effectiveRequest.provider.defaultModel
          })
          fallbackWarning = mainT('main.provider.modelUnavailableFallback', request.settings.language, {
            model: failedModel,
            fallback: effectiveRequest.provider.defaultModel
          })
        }
      }
      void trackTelemetryEvent('chat_completed', {
        ...getChatTelemetryProperties(effectiveRequest),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        finish_reason: finishReason || 'unknown',
        truncated: isTruncated
      })
      runLedger.record(run.id, 'model_request_completed', 'planning', {
        attempt: modelAttempt,
        finishReason: finishReason || 'unknown'
      })
      if (!isCurrentActiveResponse(active.key, active.controller)) {
        runLedger.record(run.id, 'run_stopped', 'stopped', {
          reason: 'replaced',
          durationMs: Date.now() - requestStartedAt
        })
        return
      }
      writeMainLog(
        `Chat request completed: conversation=${request.conversationId}, durationMs=${Date.now() - requestStartedAt}, inputTokens=${inputTokens}, outputTokens=${outputTokens}, finishReason=${finishReason || 'unknown'}.`
      )
      runLedger.record(run.id, 'run_succeeded', 'succeeded', {
        durationMs: Date.now() - requestStartedAt,
        inputTokens,
        outputTokens,
        totalTokens,
        finishReason: finishReason || 'unknown',
        truncated: isTruncated,
        savedCharacters: contextSavings?.savedCharacters ?? 0
      })
      broadcastChatActivity({ conversationId: request.conversationId, active: false })
      event.sender.send('chat:chunk', {
        ...chunkBase,
        content: '',
        done: true,
        finishReason: finishReason || undefined,
        isTruncated,
        contextSavings,
        warning: [fallbackWarning, isTruncated ? buildTruncationWarning(effectiveRequest, finishReason) : '']
          .filter(Boolean)
          .join('\n') || undefined
      })
    } catch (error) {
      if (active.controller.signal.aborted) {
        const isCurrent = isCurrentActiveResponse(active.key, active.controller)
        if (isCurrent) {
          broadcastChatActivity({ conversationId: request.conversationId, active: false })
          event.sender.send('chat:chunk', {
            ...chunkBase,
            content: '',
            done: true,
            cancelled: true,
            warning: mainT('workspace.generationStopped', request.settings.language)
          })
        }
        writeMainLog(
          `Chat request ${isCurrent ? 'cancelled' : 'replaced'}: conversation=${request.conversationId}, durationMs=${Date.now() - requestStartedAt}.`
        )
        runLedger.record(run.id, 'run_stopped', 'stopped', {
          reason: isCurrent ? 'cancelled' : 'replaced',
          durationMs: Date.now() - requestStartedAt
        })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      void trackTelemetryEvent('chat_failed', {
        ...getChatTelemetryProperties(effectiveRequest),
        error_category: getErrorCategory(error)
      })
      if (isCurrentActiveResponse(active.key, active.controller)) {
        broadcastChatActivity({ conversationId: request.conversationId, active: false, error: message })
        event.sender.send('chat:chunk', { ...chunkBase, content: '', done: true, error: message })
      }
      writeMainLog(
        `Chat request failed: conversation=${request.conversationId}, durationMs=${Date.now() - requestStartedAt}, category=${getErrorCategory(error)}.`,
        error
      )
      runLedger.record(run.id, 'model_request_failed', 'planning', {
        attempt: modelAttempt,
        errorCategory: getErrorCategory(error)
      })
      runLedger.record(run.id, 'run_failed', 'failed', {
        durationMs: Date.now() - requestStartedAt,
        errorCategory: getErrorCategory(error),
        error: message
      })
    } finally {
      releaseActiveResponse(active.key, active.controller)
    }
  })

  setupTray()
  isMainProcessReady = true
  if (pendingDeepLink) {
    const link = pendingDeepLink
    pendingDeepLink = null
    showMainWindowForDeepLink(link, 'startup')
  } else {
    createWindow()
  }
  const startupBackgroundTimer = setTimeout(() => {
    void refreshStaleOfficialProviderCatalogs()
    void trackTelemetryEvent('app_started')
  }, 1_500)
  startupBackgroundTimer.unref?.()
  autoUpdateManager.scheduleAutomaticChecks()

  screen.on('display-metrics-changed', () => {
    if (floatingLogoWindow?.isVisible()) {
      setFloatingLogoBounds(getFloatingLogoBounds())
      positionFloatingMascotHint()
    }
  })

  app.on('activate', () => {
    const window = createWindow()
    if (process.platform === 'darwin') app.focus({ steal: true })
    window.restore()
    window.show()
    window.focus()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  clearFloatingMascotHintSchedule()
  if (floatingMascotHintHideTimer) clearTimeout(floatingMascotHintHideTimer)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit()
})
