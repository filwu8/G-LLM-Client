/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import {
  BarChart3,
  Brain,
  BookOpen,
  Briefcase,
  CircleCheck,
  CircleAlert,
  Code2,
  Copy,
  Crown,
  Database,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  GraduationCap,
  ImagePlus,
  KeyRound,
  Languages,
  MessageSquarePlus,
  MonitorCog,
  Moon,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plug,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Search,
  Send,
  Settings,
  Square,
  SlidersHorizontal,
  Sparkles,
  Sun,
  AtSign,
  Trash2,
  Upload,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react'
import {
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import logo from './assets/gllm-logo.png'
import { ChatErrorRetry } from './ChatErrorRetry'
import { getChatErrorPresentation } from './chatErrors'
import { coalesceChatChunks, mergeConversationChange } from './chatPerformance'
import {
  acknowledgeConversationRun,
  attachDraftWorkspace,
  collapsePristineConversationDrafts,
  finishConversationRun,
  isPristineConversationDraft,
  isConversationRunning,
  removeConversationRun,
  startConversationRun,
  stopConversationWebSearch,
  stopPendingWebSearch,
  syncConversationUpdateIntoStreamingDrafts,
  type ConversationRunStates
} from './conversationRuntime'
import { replaceUserMessageBranch } from './conversationEditing'
import {
  getMessageSelectionSnapshot,
  writePlainTextToClipboard,
  writeRichTextToClipboard,
  type MessageSelectionSnapshot
} from './clipboard'
import {
  MAIN_COMPOSER_DRAFT_KEY,
  persistComposerDraft,
  readComposerDraft,
  resizeComposerTextarea
} from './composerInput'
import { getMessageSendShortcutLabel, shouldSendMessageFromKeyboard } from './keyboard'
import { applyRendererLanguage, rendererI18n } from './i18n'
import { ImagePreviewDialog, type ImagePreviewSource } from './ImagePreviewDialog'
import { MarkdownMessage } from './MarkdownMessage'
import { LocalTaskPanel } from './LocalTaskPanel'
import {
  findLocalizedAssistantPreset,
  localizeAssistant,
  localizeAssistantPresetCategory,
  searchLocalizedAssistantPresets
} from './localizedContent'
import { ModelResponseWait, WorkspaceActivityLog, WorkspaceApprovalDialog, WorkspaceBar, WorkspaceOperationApprovalDialog } from './WorkspaceBar'
import { getModelDisplayLabel, getModelOptions, ModelPickerMenu } from './ModelPicker'
import { WebSearchModePicker } from './WebSearchModePicker'
import { applyDocumentTheme } from './theme'
import { formatMessageTimestamp, getTimeZoneOptionLabel, resolveTimeZone, TIME_ZONE_OPTIONS } from './timeZone'
import { sortAssistantsForSidebar, sortConversationsForSidebar } from '@shared/sidebarOrdering'
import {
  ASSISTANT_PRESET_CATEGORIES,
  type AssistantPreset
} from '@shared/assistantPresets'
import { DEFAULT_ASSISTANTS, getAssistantById } from '@shared/assistants'
import { decideConversationWebSearch } from '@shared/webSearchMode'
import {
  DEFAULT_PROVIDER,
  DEFAULT_PROVIDER_ID,
  PROVIDER_TEMPLATES,
  createProviderFromTemplate,
  getProviderById,
  resolveProviderModelId
} from '@shared/providers'
import {
  getModelCapabilities,
  inferModelCapabilities,
  inferModelType,
  normalizeModelCapabilities
} from '@shared/modelCapabilities'
import type {
  ApiProvider,
  AppSettings,
  AppStateSnapshot,
  AppUpdateInfo,
  Assistant,
  AssistantIcon,
  AssistantMemory,
  AttachmentKind,
  AssistantSuggestion,
  ChatChunk,
  ChatMessage,
  ChatRequest,
  ClipboardAttachmentInput,
  Conversation,
  ConversationSearchResponse,
  ConversationSearchResult,
  DataLocationInfo,
  KnowledgeReference,
  KnowledgeNote,
  LegalDocument,
  LocalTaskPlan,
  LocalTaskProgress,
  LocalTaskResult,
  MessageRetryAttempt,
  PreparedAttachment,
  Project,
  ProviderCheckResult,
  ProviderTemplateCategory,
  ProviderTemplateId,
  ReasoningEffort,
  ToolConfig,
  ToolConfigType,
  ThemeEntitlementResult,
  WebSearchActivity,
  WebSearchMode,
  ConversationWorkspace,
  WorkspaceApprovalPrompt,
  WorkspaceToolActivity
} from '@shared/types'

const iconMap: Record<AssistantIcon, LucideIcon> = {
  sparkles: Sparkles,
  file: FileText,
  scale: Scale,
  code: Code2,
  chart: BarChart3,
  graduation: GraduationCap,
  brain: Brain,
  briefcase: Briefcase,
  pen: Pencil
}

const bottomFollowThreshold = 96
const maxPastedAttachmentBytes = 12 * 1024 * 1024
const quoteReferencePrefix = 'quote_'
const defaultSpaceId = 'project_default'
const providerTemplateCategoryOrder: ProviderTemplateCategory[] = ['default', 'global', 'china', 'aggregator', 'local']

type SessionStateUpdate<T> = T | ((current: T) => T)

function resolveSessionStateUpdate<T>(update: SessionStateUpdate<T>, current: T): T {
  return typeof update === 'function' ? (update as (value: T) => T)(current) : update
}

function getComposerSessionKey(conversationId: string | null, projectId: string, assistantId: string): string {
  return conversationId ? `conversation:${conversationId}` : `new:${projectId || 'loading'}:${assistantId}`
}

function getComposerDraftStorageKey(sessionKey: string): string {
  return `${MAIN_COMPOSER_DRAFT_KEY}:${encodeURIComponent(sessionKey)}`
}

interface TokenUsage {
  total: number
  input: number
  output: number
}

interface ApiTokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface SelectionContextMenu {
  x: number
  y: number
  text: string
  html: string
}

interface ImageAttachmentContextMenu {
  x: number
  y: number
  attachment: PreparedAttachment
}

interface AssistantContextMenu {
  x: number
  y: number
  assistantId: string
}

interface ConversationContextMenu {
  x: number
  y: number
  conversationId: string
}

type SettingsTab = 'providers' | 'personalization' | 'storage' | 'about'

interface SpaceFormPayload {
  name: string
  description: string
  logoDataUrl?: string
  workspacePath?: string
}

interface WorkspaceArtifactContextMenu {
  x: number
  y: number
  rootPath: string
  relativePath: string
}

const settingsTabs: SettingsTab[] = ['providers', 'personalization', 'storage', 'about']

function ModalBackdrop({
  className = 'assistant-modal-backdrop',
  closeOnBackdropClick = true,
  children,
  onClose
}: {
  className?: string
  closeOnBackdropClick?: boolean
  children: ReactNode
  onClose: () => void
}) {
  const backdropMouseDownRef = useRef(false)

  function handleMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    backdropMouseDownRef.current = closeOnBackdropClick && event.target === event.currentTarget
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (backdropMouseDownRef.current && event.target === event.currentTarget) {
      onClose()
    }
    backdropMouseDownRef.current = false
  }

  return (
    <div className={className} onClick={handleClick} onMouseDown={handleMouseDown}>
      {children}
    </div>
  )
}

function stopModalClick(event: ReactMouseEvent) {
  event.stopPropagation()
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function estimateTokenCount(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0

  const cjkCount = normalized.match(/[\u4e00-\u9fff]/g)?.length ?? 0
  const nonCjkTokens =
    normalized
      .replace(/[\u4e00-\u9fff]/g, ' ')
      .match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0

  return Math.max(1, Math.ceil(cjkCount + nonCjkTokens * 0.75))
}

function sanitizeLocalToken(value: unknown): number | null {
  const token = Number(value)
  return Number.isFinite(token) && token >= 0 ? Math.round(token) : null
}

function formatTokenUnit(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 10_000 ? 0 : 1))}K`
  return `${value}`
}

function getSpaceName(project: Project | null): string {
  if (!project) return rendererI18n.t('app.defaultSpaceName')
  if (project.id === defaultSpaceId) {
    return rendererI18n.t('app.defaultSpaceName')
  }
  return project.name || rendererI18n.t('app.unnamedSpace')
}

function getSpaceDescription(project: Project | null): string {
  if (!project) return rendererI18n.t('app.defaultSpace')
  if (project.id === defaultSpaceId) {
    return !project.description || project.description === '默认空间' || project.description === '默认空间，用于保存你的通用助手、历史会话和全局资料'
      ? rendererI18n.t('app.defaultSpaceDescription')
      : project.description
  }
  return project.description || rendererI18n.t('app.independentSpace')
}

function SpaceLogo({ className = '', project }: { className?: string; project: Project | null }) {
  const classes = ['space-logo', className, project?.logoDataUrl ? 'custom' : ''].filter(Boolean).join(' ')

  if (!project || project.id === defaultSpaceId) {
    return <img className={classes} src={logo} alt="" />
  }

  if (project.logoDataUrl) {
    return <img className={classes} src={project.logoDataUrl} alt="" />
  }

  return (
    <span className={classes} aria-hidden="true">
      {getSpaceName(project).slice(0, 1).toLocaleUpperCase()}
    </span>
  )
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${Number((size / 1024 / 1024).toFixed(1))} MB`
  if (size >= 1024) return `${Number((size / 1024).toFixed(1))} KB`
  return `${size} B`
}

function getFileExtensionFromMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (mimeType.startsWith('text/')) return 'txt'
  return 'bin'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(rendererI18n.t('notices.clipboardReadFailed')))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

function cropImageToSquareDataUrl(source: string, zoom = 1): Promise<string> {
  const size = 256
  const normalizedZoom = Math.min(2.5, Math.max(1, zoom))

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error(rendererI18n.t('assistantSettings.errors.imageRead')))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error(rendererI18n.t('assistantSettings.errors.cropUnavailable')))
        return
      }

      const coverScale = Math.max(size / image.naturalWidth, size / image.naturalHeight) * normalizedZoom
      const width = image.naturalWidth * coverScale
      const height = image.naturalHeight * coverScale
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.clearRect(0, 0, size, size)
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
      resolve(canvas.toDataURL('image/webp', 0.92))
    }
    image.src = source
  })
}

function getClipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files ?? [])
  if (files.length > 0) return files

  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

function estimateMessageTokenUsage(message: ChatMessage): TokenUsage {
  const storedInput = sanitizeLocalToken(message.inputTokens)
  const storedOutput = sanitizeLocalToken(message.outputTokens)
  const storedTotal = sanitizeLocalToken(message.tokenCount)
  if (storedInput !== null && storedOutput !== null && storedTotal !== null) {
    return { total: storedTotal, input: storedInput, output: storedOutput }
  }

  const contentTokens = estimateTokenCount(message.content)
  const reasoningTokens = estimateTokenCount(message.reasoningContent ?? '')
  const translationTokens = estimateTokenCount(message.translation ?? '')
  const knowledgeTokens = message.role === 'assistant' ? 0 : estimateTokenCount(getKnowledgeReferenceText(message.knowledgeRefs ?? []))
  const fallbackInput = message.role === 'assistant' ? 0 : contentTokens + knowledgeTokens
  const fallbackOutput = message.role === 'assistant' ? contentTokens + reasoningTokens + translationTokens : translationTokens
  const input = storedInput ?? fallbackInput
  const output = storedOutput ?? fallbackOutput
  const total = storedTotal ?? input + output

  return { total, input, output }
}

function getConversationTokenUsage(conversation: Conversation | null): TokenUsage {
  if (!conversation) return { total: 0, input: 0, output: 0 }

  const storedInput = sanitizeLocalToken(conversation.totalInputTokens)
  const storedOutput = sanitizeLocalToken(conversation.totalOutputTokens)
  const storedTotal = sanitizeLocalToken(conversation.totalTokens)
  if (storedInput !== null && storedOutput !== null && storedTotal !== null) {
    return { total: storedTotal, input: storedInput, output: storedOutput }
  }

  return conversation.messages.reduce<TokenUsage>(
    (sum, message) => {
      const usage = estimateMessageTokenUsage(message)
      return {
        total: sum.total + usage.total,
        input: sum.input + usage.input,
        output: sum.output + usage.output
      }
    },
    { total: 0, input: 0, output: 0 }
  )
}

function withTokenCount(message: ChatMessage): ChatMessage {
  const contentTokens = estimateTokenCount(message.content)
  const reasoningTokens = estimateTokenCount(message.reasoningContent ?? '')
  const translationTokens = estimateTokenCount(message.translation ?? '')
  const inputTokens = message.role === 'assistant' ? 0 : contentTokens
  const outputTokens = message.role === 'assistant' ? contentTokens + reasoningTokens + translationTokens : translationTokens

  return {
    ...message,
    tokenCount: inputTokens + outputTokens,
    inputTokens,
    outputTokens
  }
}

function withApiTokenUsage(message: ChatMessage, usage: ApiTokenUsage): ChatMessage {
  return {
    ...message,
    tokenCount: usage.totalTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens
  }
}

function withWebSearchActivity(message: ChatMessage, webSearch: WebSearchActivity): ChatMessage {
  return {
    ...message,
    webSearch
  }
}

function withConversationTokens(conversation: Conversation): Conversation {
  const messages = conversation.messages.map((message) => {
    const usage = estimateMessageTokenUsage(message)
    return {
      ...message,
      tokenCount: usage.total,
      inputTokens: usage.input,
      outputTokens: usage.output
    }
  })
  const usage = messages.reduce<TokenUsage>(
    (sum, message) => ({
      total: sum.total + (message.tokenCount ?? 0),
      input: sum.input + (message.inputTokens ?? 0),
      output: sum.output + (message.outputTokens ?? 0)
    }),
    { total: 0, input: 0, output: 0 }
  )

  return {
    ...conversation,
    messages,
    totalTokens: usage.total,
    totalInputTokens: usage.input,
    totalOutputTokens: usage.output
  }
}

function createConversation(assistant: Assistant, provider: ApiProvider, projectId?: string): Conversation {
  const now = Date.now()
  return {
    id: createId('conv'),
    projectId,
    assistantId: assistant.id,
    title: assistant.name,
    messages: [],
    modelProviderId: provider.id,
    modelId: provider.defaultModel,
    reasoningEffort: 'default',
    webSearchMode: 'off',
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    createdAt: now,
    updatedAt: now
  }
}

function getWebSearchRequestSettings(
  mode: WebSearchMode,
  conversation: Conversation
): Pick<ChatRequest, 'webSearchMode' | 'webSearchEnabled'> {
  return {
    webSearchMode: mode,
    webSearchEnabled: decideConversationWebSearch(mode, conversation.messages).enabled
  }
}

function formatSidebarConversationTime(timestamp: number, locale: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function getKnowledgeReferenceText(knowledgeRefs: KnowledgeReference[] = []): string {
  return knowledgeRefs.map((reference) => `${reference.title}\n${reference.content}`).join('\n\n')
}

function isQuoteReference(reference: KnowledgeReference): boolean {
  return reference.id.startsWith(quoteReferencePrefix)
}

function getQuoteReferenceTitle(content: string): string {
  const firstLine =
    content
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? rendererI18n.t('notices.quoteContent')
  const collapsed = firstLine.replace(/\s+/g, ' ')
  return rendererI18n.t('notices.quoteTitle', { text: collapsed.length > 22 ? `${collapsed.slice(0, 22)}...` : collapsed })
}

function createMessage(
  role: ChatMessage['role'],
  content: string,
  attachments: PreparedAttachment[] = [],
  knowledgeRefs: KnowledgeReference[] = []
): ChatMessage {
  const knowledgeTokens = role === 'assistant' ? 0 : estimateTokenCount(getKnowledgeReferenceText(knowledgeRefs))
  const inputTokens = role === 'assistant' ? 0 : estimateTokenCount(content) + knowledgeTokens
  const outputTokens = role === 'assistant' ? estimateTokenCount(content) : 0

  return {
    id: createId('msg'),
    role,
    content,
    attachments: attachments.length > 0 ? attachments : undefined,
    knowledgeRefs: knowledgeRefs.length > 0 ? knowledgeRefs : undefined,
    tokenCount: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    createdAt: Date.now()
  }
}

function formatWorkspaceError(value: string): string {
  const normalized = value
    .replace(/^Error invoking remote method 'workspace-agent:run':\s*Error:\s*/i, '')
    .trim()
  const presentation = getChatErrorPresentation(normalized)
  if (presentation.automaticallyRetryable || /<!doctype\s+html|<html[\s>]/i.test(normalized)) return presentation.userMessage
  return normalized || rendererI18n.t('workspaceErrors.unknown')
}

function applyChatChunkToConversation(conversation: Conversation, chunk: ChatChunk): Conversation {
  let messages = [...conversation.messages]
  const last = messages[messages.length - 1]

  if (chunk.targetMessageId && chunk.purpose === 'translation') {
    messages = messages.map((message) => {
      if (message.id !== chunk.targetMessageId) return message
      if (chunk.error) return withTokenCount({ ...message, translation: rendererI18n.t('notices.translationFailed', { error: chunk.error }) })
      let nextMessage = chunk.content
        ? withTokenCount({ ...message, translation: `${message.translation ?? ''}${chunk.content}` })
        : message
      if (chunk.usage) nextMessage = withApiTokenUsage(nextMessage, chunk.usage)
      return nextMessage
    })
  } else if (chunk.error) {
    const presentation = getChatErrorPresentation(chunk.error)
    messages.push({
      ...createMessage('assistant', presentation.userMessage),
      error: presentation.technicalDetail,
      retryAt: presentation.automaticallyRetryable ? Date.now() + 60_000 : undefined
    })
  } else {
    let assistantMessage = last?.role === 'assistant' ? last : null
    if (!assistantMessage && (chunk.content || chunk.reasoningContent || chunk.webSearch)) {
      assistantMessage = createMessage('assistant', '')
      messages.push(assistantMessage)
    }

    if (assistantMessage) {
      let nextMessage = assistantMessage
      if (chunk.webSearch) nextMessage = withWebSearchActivity(nextMessage, chunk.webSearch)
      if (chunk.cancelled) {
        nextMessage = { ...nextMessage, webSearch: stopPendingWebSearch(nextMessage.webSearch) }
      }
      if (chunk.content || chunk.reasoningContent) {
        nextMessage = withTokenCount({
          ...nextMessage,
          content: nextMessage.content + chunk.content,
          reasoningContent: `${nextMessage.reasoningContent ?? ''}${chunk.reasoningContent ?? ''}` || undefined
        })
      }
      if (chunk.usage) nextMessage = withApiTokenUsage(nextMessage, chunk.usage)
      if (chunk.contextSavings) nextMessage = { ...nextMessage, contextSavings: chunk.contextSavings }
      messages[messages.length - 1] = nextMessage
    }
  }

  return withConversationTokens({ ...conversation, messages, updatedAt: Date.now() })
}

function getUrlHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function formatSearchResultDate(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function WebSearchActivityCard({ activity }: { activity: WebSearchActivity }) {
  const { t } = useTranslation()
  const isPlanning = activity.status === 'planning'
  const isSearching = activity.status === 'searching'
  const isFailed = activity.status === 'failed'
  const isStopped = activity.status === 'stopped'
  const audit = activity.audit
  const rejectedCount = audit
    ? audit.duplicateCount + audit.outdatedCount + audit.notApplicableCount + audit.lowRelevanceCount
    : 0
  const activeQueries = new Set(activity.activeQueries ?? [])
  const completedQueries = new Set(activity.completedQueries ?? [])
  const title = isPlanning
    ? t('webActivity.planning')
    : isSearching
      ? t('webActivity.searching')
      : isStopped
        ? t('webActivity.stopped')
      : isFailed
        ? t('webActivity.failed')
        : t('webActivity.complete', { count: activity.results.length })

  return (
    <div className={`web-search-card ${activity.status}`}>
      <div className="web-search-head">
        <span className="web-search-icon">
          {isPlanning || isSearching ? (
            <span className="mini-spinner" aria-hidden="true" />
          ) : (
            <Globe2 size={15} />
          )}
        </span>
        <div>
          <strong>{title}</strong>
          <small>{activity.intent || activity.query}</small>
        </div>
      </div>
      {activity.queries && activity.queries.length > 0 && (
        <div className="web-search-query-list">
          {activity.queries.map((query) => (
            <span
              key={query}
              className={completedQueries.has(query) ? 'completed' : activeQueries.has(query) ? 'active' : 'pending'}
            >
              {query}
            </span>
          ))}
        </div>
      )}
      {audit && !isPlanning && (
        <div className="web-research-audit" aria-label={t('webActivity.auditLabel')}>
          <span>{t(`webActivity.depth.${audit.depth}`)}</span>
          {activity.status === 'completed' && (
            <>
              <span>{t('webActivity.evidence', { accepted: audit.acceptedCount, candidates: audit.candidateCount })}</span>
              <span>{t('webActivity.coverage', { covered: audit.coveredQuestionCount, total: audit.totalQuestionCount })}</span>
              {audit.contextCharacterBudget && (
                <span>{t('webActivity.contextBudget', { count: Math.round(audit.contextCharacterBudget / 100) / 10 })}</span>
              )}
              {audit.searchEngines && audit.searchEngines.length > 0 && (
                <span>{t('webActivity.engines', { engines: audit.searchEngines.join(' · ') })}</span>
              )}
              {audit.unavailableSearchEngines && audit.unavailableSearchEngines.length > 0 && (
                <span className="conflict">{t('webActivity.enginesUnavailable', { engines: audit.unavailableSearchEngines.join(' · ') })}</span>
              )}
              {rejectedCount > 0 && <span>{t('webActivity.rejected', { count: rejectedCount })}</span>}
              {audit.conflictCount > 0 && <span className="conflict">{t('webActivity.conflicts', { count: audit.conflictCount })}</span>}
            </>
          )}
          {isSearching && (
            <>
              <span>{t('webActivity.liveProgress', { completed: completedQueries.size, total: activity.queries?.length ?? 0, candidates: audit.candidateCount })}</span>
              {audit.searchEngines && audit.searchEngines.length > 0 && (
                <span>{t('webActivity.engines', { engines: audit.searchEngines.join(' · ') })}</span>
              )}
            </>
          )}
        </div>
      )}
      {audit?.plannerMode === 'fallback' && (
        <p className="web-search-warning" title={audit.plannerError}>
          {t('webActivity.plannerFallback')}
        </p>
      )}
      {isFailed && activity.error && <p className="web-search-error">{activity.error}</p>}
      {activity.results.length > 0 && (
        <div className="web-search-results">
          {activity.results.map((result, index) => (
            <a
              key={`${result.url}-${index}`}
              href={result.url}
              target="_blank"
              rel="noreferrer"
              title={result.url}
              style={{ '--web-result-index': index } as CSSProperties}
            >
              <span>{index + 1}</span>
              <div className="web-search-result-content">
                <strong>{result.title}</strong>
                <small>
                  {result.sourceRole ? `${t(`webActivity.sourceRole.${result.sourceRole}`)} · ` : ''}
                  {result.source || result.sourceDomain || getUrlHost(result.url)}
                  {result.publishedAt ? ` · ${formatSearchResultDate(result.publishedAt)}` : ''}
                </small>
                {result.snippet && <p>{result.snippet.slice(0, 120)}</p>}
                <small>{result.url}</small>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function AssistantAvatar({ assistant, className = '' }: { assistant: Assistant; className?: string }) {
  const Icon = iconMap[assistant.icon] ?? Sparkles
  const classes = ['assistant-icon', assistant.color, assistant.avatarDataUrl ? 'custom-avatar' : '', className].filter(Boolean).join(' ')

  return (
    <span className={classes}>
      {assistant.avatarDataUrl ? <img src={assistant.avatarDataUrl} alt="" /> : <Icon size={18} />}
    </span>
  )
}

function getComparableSettings(settings: AppSettings) {
  return {
    activeProviderId: settings.activeProviderId,
    language: settings.language,
    timeZone: settings.timeZone,
    theme: settings.theme,
    webSearchMode: settings.webSearchMode,
    temperature: Number(settings.temperature),
    enableTemperature: settings.enableTemperature,
    maxTokens: Number(settings.maxTokens),
    enableMaxTokens: settings.enableMaxTokens,
    messageSendShortcut: settings.messageSendShortcut,
    floatingMascotSkin: settings.floatingMascotSkin,
    floatingMascotHints: settings.floatingMascotHints,
    floatingMascotVisible: settings.floatingMascotVisible,
    telemetryEnabled: settings.telemetryEnabled,
    setupCompleted: settings.setupCompleted
  }
}

function getComparableProvider(provider: ApiProvider) {
  return {
    id: provider.id,
    templateId: provider.templateId,
    name: provider.name,
    apiBaseUrl: provider.apiBaseUrl,
    chatCompletionsPath: provider.chatCompletionsPath ?? '',
    imageGenerationsPath: provider.imageGenerationsPath ?? '',
    modelsPath: provider.modelsPath ?? '',
    apiKey: provider.apiKey,
    defaultModel: provider.defaultModel,
    requiresApiKey: provider.requiresApiKey,
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name ?? '',
      ownedBy: model.ownedBy ?? '',
      type: model.type ?? inferModelType(model.id),
      capabilities: normalizeModelCapabilities(model)
    }))
  }
}

function getEffectiveProvider(
  selection: Pick<Assistant | Conversation, 'modelProviderId' | 'modelId'>,
  fallbackProvider: ApiProvider,
  providers: ApiProvider[]
): ApiProvider {
  const provider = selection.modelProviderId ? getProviderById(selection.modelProviderId, providers) : fallbackProvider
  const modelId = selection.modelId?.trim()

  if (!modelId) return provider

  const resolvedModelId = resolveProviderModelId(provider, modelId)

  return {
    ...provider,
    defaultModel: resolvedModelId,
    models: getModelOptions(provider, resolvedModelId)
  }
}

export default function App() {
  const { t, i18n } = useTranslation()
  const isMac = window.gllm.platform === 'darwin'
  const isWindows = window.gllm.platform === 'win32'
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [goldThemeEntitled, setGoldThemeEntitled] = useState(false)
  const [goldThemeEntitlementChecked, setGoldThemeEntitlementChecked] = useState(false)
  const [providers, setProviders] = useState<ApiProvider[]>([DEFAULT_PROVIDER])
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState('')
  const [assistants, setAssistants] = useState<Assistant[]>(DEFAULT_ASSISTANTS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [notes, setNotes] = useState<KnowledgeNote[]>([])
  const [memories, setMemories] = useState<AssistantMemory[]>([])
  const [tools, setTools] = useState<ToolConfig[]>([])
  const [appVersion, setAppVersion] = useState('1.0.0')
  const [appBuildCode, setAppBuildCode] = useState('')
  const [dataLocation, setDataLocation] = useState<DataLocationInfo | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [activeAssistantId, setActiveAssistantId] = useState(DEFAULT_ASSISTANTS[0].id)
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({})
  const [composerAttachments, setComposerAttachments] = useState<Record<string, PreparedAttachment[]>>({})
  const [composerQuoteRefs, setComposerQuoteRefs] = useState<Record<string, KnowledgeReference[]>>({})
  const [composerKnowledgeRefs, setComposerKnowledgeRefs] = useState<Record<string, KnowledgeReference[]>>({})
  const [conversationRunStates, setConversationRunStates] = useState<ConversationRunStates>({})
  const [isPickingAttachment, setIsPickingAttachment] = useState(false)
  const [localTaskPlan, setLocalTaskPlan] = useState<LocalTaskPlan | null>(null)
  const [localTaskProgress, setLocalTaskProgress] = useState<LocalTaskProgress | null>(null)
  const [localTaskResult, setLocalTaskResult] = useState<LocalTaskResult | null>(null)
  const [localTaskRunning, setLocalTaskRunning] = useState(false)
  const [draftWorkspace, setDraftWorkspace] = useState<ConversationWorkspace | undefined>()
  const [pendingWorkspaceRoot, setPendingWorkspaceRoot] = useState<string | null>(null)
  const [workspaceApprovalPrompts, setWorkspaceApprovalPrompts] = useState<WorkspaceApprovalPrompt[]>([])
  const [workspaceActivitiesByConversation, setWorkspaceActivitiesByConversation] = useState<Record<string, WorkspaceToolActivity[]>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('providers')
  const [assistantCenterOpen, setAssistantCenterOpen] = useState(false)
  const [assistantSettingsOpen, setAssistantSettingsOpen] = useState(false)
  const [conversationModelOpen, setConversationModelOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [toolCenterOpen, setToolCenterOpen] = useState(false)
  const [spaceCenterOpen, setSpaceCenterOpen] = useState(false)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [assistantSearchQuery, setAssistantSearchQuery] = useState('')
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false)
  const [conversationSearchQuery, setConversationSearchQuery] = useState('')
  const [conversationSearchResponse, setConversationSearchResponse] = useState<ConversationSearchResponse | null>(null)
  const [conversationSearchLoading, setConversationSearchLoading] = useState(false)
  const [conversationSearchError, setConversationSearchError] = useState('')
  const [toolNotice, setToolNotice] = useState<{
    message: string
    emphasis: boolean
    requiresConfirmation: boolean
    conversationId?: string
    settingsTab?: SettingsTab
  } | null>(null)
  const [selectionMenu, setSelectionMenu] = useState<SelectionContextMenu | null>(null)
  const [imageAttachmentMenu, setImageAttachmentMenu] = useState<ImageAttachmentContextMenu | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreviewSource | null>(null)
  const [workspaceArtifactMenu, setWorkspaceArtifactMenu] = useState<WorkspaceArtifactContextMenu | null>(null)
  const [assistantContextMenu, setAssistantContextMenu] = useState<AssistantContextMenu | null>(null)
  const [conversationContextMenu, setConversationContextMenu] = useState<ConversationContextMenu | null>(null)
  const [hiddenAssistantsOpen, setHiddenAssistantsOpen] = useState(false)
  const [translatingMessageIds, setTranslatingMessageIds] = useState<string[]>([])
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingMessageContent, setEditingMessageContent] = useState('')
  const [autoFollowMessages, setAutoFollowMessages] = useState(true)
  const [isNearMessageBottom, setIsNearMessageBottom] = useState(true)
  const [composerHeight, setComposerHeight] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const autoFollowMessagesRef = useRef(true)
  const toolNoticeTimerRef = useRef<number | null>(null)
  const streamingConversationDraftsRef = useRef<Record<string, Conversation>>({})
  const conversationRunStatesRef = useRef<ConversationRunStates>({})
  const activeConversationIdRef = useRef<string | null>(null)
  const activeProjectIdRef = useRef('')
  const workspaceActivitiesRef = useRef<Record<string, WorkspaceToolActivity[]>>({})
  const conversationSearchRequestRef = useRef(0)
  const pendingChatChunksRef = useRef<ChatChunk[]>([])
  const chatChunkFlushTimerRef = useRef<number | null>(null)
  const newConversationDraftRef = useRef<{ id: string; assistantId: string; projectId?: string } | null>(null)

  const composerSessionKey = getComposerSessionKey(activeConversationId, activeProjectId, activeAssistantId)
  const draft = composerDrafts[composerSessionKey] ?? readComposerDraft(getComposerDraftStorageKey(composerSessionKey))
  const pendingAttachments = composerAttachments[composerSessionKey] ?? []
  const pendingQuoteRefs = composerQuoteRefs[composerSessionKey] ?? []
  const pendingKnowledgeRefs = composerKnowledgeRefs[composerSessionKey] ?? []
  const workspaceActivities = activeConversationId
    ? workspaceActivitiesByConversation[activeConversationId] ?? []
    : []
  const workspaceApprovalPrompt = workspaceApprovalPrompts[0] ?? null
  const isStreaming = isConversationRunning(conversationRunStates, activeConversationId)

  function setDraft(update: SessionStateUpdate<string>) {
    setComposerDrafts((current) => ({
      ...current,
      [composerSessionKey]: resolveSessionStateUpdate(
        update,
        current[composerSessionKey] ?? readComposerDraft(getComposerDraftStorageKey(composerSessionKey))
      )
    }))
  }

  function setPendingAttachments(update: SessionStateUpdate<PreparedAttachment[]>) {
    setComposerAttachments((current) => ({
      ...current,
      [composerSessionKey]: resolveSessionStateUpdate(update, current[composerSessionKey] ?? [])
    }))
  }

  function setPendingQuoteRefs(update: SessionStateUpdate<KnowledgeReference[]>) {
    setComposerQuoteRefs((current) => ({
      ...current,
      [composerSessionKey]: resolveSessionStateUpdate(update, current[composerSessionKey] ?? [])
    }))
  }

  function setPendingKnowledgeRefs(update: SessionStateUpdate<KnowledgeReference[]>) {
    setComposerKnowledgeRefs((current) => ({
      ...current,
      [composerSessionKey]: resolveSessionStateUpdate(update, current[composerSessionKey] ?? [])
    }))
  }

  function moveComposerSessionToConversation(conversationId: string, clearContent = false) {
    const sourceKey = composerSessionKey
    const targetKey = getComposerSessionKey(conversationId, activeProjectId, activeAssistantId)
    if (sourceKey === targetKey) return

    const sourceDraft = composerDrafts[sourceKey] ?? readComposerDraft(getComposerDraftStorageKey(sourceKey))
    const sourceAttachments = composerAttachments[sourceKey] ?? []
    const sourceQuoteRefs = composerQuoteRefs[sourceKey] ?? []
    const sourceKnowledgeRefs = composerKnowledgeRefs[sourceKey] ?? []
    const moveValue = <T,>(current: Record<string, T>, value: T, cleared: T) => {
      const next = { ...current, [targetKey]: clearContent ? cleared : value }
      delete next[sourceKey]
      return next
    }

    setComposerDrafts((current) => moveValue(current, sourceDraft, ''))
    setComposerAttachments((current) => moveValue(current, sourceAttachments, []))
    setComposerQuoteRefs((current) => moveValue(current, sourceQuoteRefs, []))
    setComposerKnowledgeRefs((current) => moveValue(current, sourceKnowledgeRefs, []))
    persistComposerDraft(getComposerDraftStorageKey(sourceKey), '')
    persistComposerDraft(getComposerDraftStorageKey(targetKey), clearContent ? '' : sourceDraft)
  }

  function replaceConversationRunStates(next: ConversationRunStates) {
    conversationRunStatesRef.current = next
    setConversationRunStates(next)
  }

  function beginConversationRun(conversationId: string) {
    replaceConversationRunStates(startConversationRun(conversationRunStatesRef.current, conversationId))
  }

  function completeConversationRun(conversationId: string, outcome: 'completed' | 'error') {
    replaceConversationRunStates(
      finishConversationRun(
        conversationRunStatesRef.current,
        conversationId,
        activeConversationIdRef.current,
        outcome
      )
    )
  }

  function discardConversationRun(conversationId: string) {
    replaceConversationRunStates(removeConversationRun(conversationRunStatesRef.current, conversationId))
  }

  function selectConversation(conversationId: string | null) {
    activeConversationIdRef.current = conversationId
    setActiveConversationId(conversationId)
    if (!conversationId) return
    replaceConversationRunStates(acknowledgeConversationRun(conversationRunStatesRef.current, conversationId))
  }

  function clearWorkspaceActivities(conversationId: string | null = activeConversationId) {
    if (!conversationId) return
    workspaceActivitiesRef.current[conversationId] = []
    setWorkspaceActivitiesByConversation((current) => ({ ...current, [conversationId]: [] }))
  }

  const activeSpace = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null,
    [activeProjectId, projects]
  )
  const activeSpaceName = getSpaceName(activeSpace)
  const activeSpaceSubtitle = t('app.spaceSubtitle', {
    space: activeSpace?.id === defaultSpaceId ? t('app.defaultSpace') : activeSpaceName
  })
  const activeAssistant = useMemo(() => getAssistantById(activeAssistantId, assistants), [activeAssistantId, assistants])
  const activeAssistantDisplay = useMemo(
    () => localizeAssistant(activeAssistant),
    [activeAssistant, i18n.resolvedLanguage]
  )
  const activeProvider = useMemo(
    () => getProviderById(settings?.activeProviderId ?? DEFAULT_PROVIDER_ID, providers),
    [providers, settings?.activeProviderId]
  )
  const assistantDefaultProvider = useMemo(
    () => getEffectiveProvider(activeAssistant, activeProvider, providers),
    [activeAssistant, activeProvider, providers]
  )
  const activeAssistantConversations = useMemo(
    () => collapsePristineConversationDrafts(
      sortConversationsForSidebar(
        conversations.filter((conversation) => conversation.assistantId === activeAssistantId)
      ),
      activeConversationId
    ),
    [activeAssistantId, activeConversationId, conversations]
  )
  const activeConversation =
    activeAssistantConversations.find((conversation) => conversation.id === activeConversationId) ?? null
  const webSearchMode: WebSearchMode = settings?.webSearchMode ?? 'off'
  const currentWorkspace = activeConversation ? activeConversation.workspace : draftWorkspace
  const conversationProvider = useMemo(
    () => (activeConversation ? getEffectiveProvider(activeConversation, assistantDefaultProvider, providers) : assistantDefaultProvider),
    [activeConversation, assistantDefaultProvider, providers]
  )
  const activeReasoningEffort = activeConversation?.reasoningEffort ?? 'default'
  const needsApiKey = Boolean(settings && conversationProvider.requiresApiKey && !conversationProvider.apiKey.trim())
  const activeConversationTranslationSignature = activeConversation?.messages
    .map((message) => message.translation?.length ?? 0)
    .join('|')
  const activeConversationTokenUsage = getConversationTokenUsage(activeConversation)
  const topbarConversationTitle = activeConversation?.title || t('app.newConversation')
  const activeConversationTokenSummary = t('app.tokenSummary', {
    total: formatTokenUnit(activeConversationTokenUsage.total),
    input: formatTokenUnit(activeConversationTokenUsage.input),
    output: formatTokenUnit(activeConversationTokenUsage.output)
  })
  const activeConversationTokenDetail = t('app.tokenDetail', {
    total: formatTokenUnit(activeConversationTokenUsage.total),
    input: formatTokenUnit(activeConversationTokenUsage.input),
    output: formatTokenUnit(activeConversationTokenUsage.output)
  })
  const projectMemorySummary = activeConversation?.projectMemory
    ? [
        activeConversation.projectMemory.overview,
        t('workspace.projectMemoryCounts', {
          requirements: activeConversation.projectMemory.requirements.length,
          decisions: activeConversation.projectMemory.decisions.length,
          rules: activeConversation.projectMemory.businessRules.length,
          openItems: activeConversation.projectMemory.openItems.length,
          risks: activeConversation.projectMemory.risks.length
        })
      ].filter(Boolean).join('\n')
    : ''
  const showScrollToLatest = Boolean(activeConversation?.messages.length && !isNearMessageBottom)
  const waitingForAssistantResponse = Boolean(isStreaming && activeConversation?.messages.at(-1)?.role === 'user')
  const activeRunStartedAt = activeConversationId ? conversationRunStates[activeConversationId]?.startedAt : undefined
  const modelCapabilities = useMemo(() => getModelCapabilities(conversationProvider), [conversationProvider])
  const messageSendShortcut = settings?.messageSendShortcut ?? 'enter'
  const messageSendShortcutLabel = getMessageSendShortcutLabel(messageSendShortcut)
  const activeAssistantNotes = useMemo(
    () => notes.filter((note) => note.assistantId === activeAssistant.id),
    [activeAssistant.id, notes]
  )
  const activeAssistantMemories = useMemo(
    () => memories.filter((memory) => memory.assistantId === activeAssistant.id),
    [activeAssistant.id, memories]
  )
  const enabledAssistantMemories = useMemo(
    () => activeAssistantMemories.filter((memory) => memory.enabled),
    [activeAssistantMemories]
  )
  const visibleAssistants = useMemo(
    () => sortAssistantsForSidebar(assistants.filter((assistant) => !assistant.hidden), conversations),
    [assistants, conversations]
  )
  const hiddenAssistants = useMemo(() => assistants.filter((assistant) => assistant.hidden), [assistants])
  const filteredAssistants = useMemo(() => {
    const keyword = assistantSearchQuery.trim().toLocaleLowerCase()
    if (!keyword) return visibleAssistants

    return visibleAssistants.filter((assistant) => {
      const displayAssistant = localizeAssistant(assistant)
      const searchable = [
        assistant.name,
        assistant.title,
        displayAssistant.name,
        displayAssistant.title,
        assistant.tone,
        assistant.systemPrompt,
        ...assistant.starterPrompts,
        ...displayAssistant.starterPrompts
      ]
        .join(' ')
        .toLocaleLowerCase()

      return searchable.includes(keyword)
    })
  }, [assistantSearchQuery, visibleAssistants, i18n.resolvedLanguage])

  function applyAppState(state: AppStateSnapshot, options: { selectFirstConversation?: boolean } = {}) {
    const nextProviders = state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER]
    const nextAssistants = state.assistants.length > 0 ? state.assistants : DEFAULT_ASSISTANTS
    const nextVisibleAssistants = nextAssistants.filter((assistant) => !assistant.hidden)
    const firstAssistant = sortAssistantsForSidebar(nextVisibleAssistants, state.conversations)[0] ?? null
    const firstConversation = firstAssistant
      ? sortConversationsForSidebar(
          state.conversations.filter((conversation) => conversation.assistantId === firstAssistant.id)
        )[0] ?? null
      : null

    setAppVersion(state.appVersion || '1.0.0')
    setAppBuildCode(state.appBuildCode || '')
    setDataLocation(state.dataLocation)
    activeProjectIdRef.current = state.activeProjectId
    setActiveProjectId(state.activeProjectId)
    setProjects(state.projects)
    setSettings(state.settings)
    setProviders(nextProviders)
    setAssistants(nextAssistants)
    setConversations(state.conversations)
    setNotes(state.notes)
    setMemories(state.memories ?? [])
    setTools(state.tools ?? [])

    if (options.selectFirstConversation) {
      selectConversation(firstConversation?.id ?? null)
      setActiveAssistantId(firstAssistant?.id ?? DEFAULT_ASSISTANTS[0].id)
    }
  }

  async function checkThemeEntitlement(): Promise<ThemeEntitlementResult> {
    const result = await window.gllm.checkThemeEntitlement()
    setGoldThemeEntitled(result.eligible)
    setGoldThemeEntitlementChecked(true)
    return result
  }

  useEffect(() => {
    if (!isWindows) return
    document.title = `${activeSpaceName} - ${activeAssistantDisplay.name} - ${activeAssistantDisplay.title} | G-LLM`
  }, [activeAssistantDisplay.name, activeAssistantDisplay.title, activeSpaceName, isWindows])

  useEffect(() => {
    void window.gllm.getState().then((state) => {
      const nextProviders = state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER]
      const provider = getProviderById(state.settings.activeProviderId, nextProviders)
      applyAppState(state, { selectFirstConversation: true })
      if (!state.settings.setupCompleted) {
        setAgreementOpen(true)
      } else if (provider.requiresApiKey && !provider.apiKey.trim()) {
        setSettingsOpen(true)
      }
    })
  }, [])

  useEffect(() => {
    return window.gllm.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings)
    })
  }, [])

  useEffect(() => {
    return window.gllm.onProvidersChanged((nextProviders) => {
      setProviders(nextProviders.length > 0 ? nextProviders : [DEFAULT_PROVIDER])
    })
  }, [])

  useEffect(() => {
    return window.gllm.onAppUpdateStatus((status) => {
      if (status.status !== 'available') return
      showToolNotice(status.message, 10_000, { settingsTab: 'about' })
    })
  }, [])

  useEffect(() => {
    return window.gllm.onDeepLinkHandoffStatus(({ status }) => {
      if (status === 'success') {
        setSettingsOpen(false)
        void window.gllm.getState().then((state) => applyAppState(state))
      }
      showToolNotice(t(status === 'success' ? 'notices.browserKeyImported' : 'notices.browserKeyImportFailed'), 3600, {
        emphasis: status === 'error'
      })
    })
  }, [t])

  useEffect(() => {
    if (settings) applyDocumentTheme(settings.theme, true)
  }, [settings?.theme])

  useEffect(() => {
    if (settings) applyRendererLanguage(settings.language)
  }, [settings?.language])

  useEffect(() => {
    void window.gllm.setActiveAssistantId(activeAssistantId)
  }, [activeAssistantId])

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId
  }, [activeProjectId])

  useEffect(() => {
    const legacyDraft = readComposerDraft(MAIN_COMPOSER_DRAFT_KEY)
    if (!activeProjectId || !legacyDraft) return
    const storageKey = getComposerDraftStorageKey(composerSessionKey)
    setComposerDrafts((current) => {
      if (current[composerSessionKey] !== undefined || readComposerDraft(storageKey)) return current
      return { ...current, [composerSessionKey]: legacyDraft }
    })
    persistComposerDraft(MAIN_COMPOSER_DRAFT_KEY, '')
  }, [activeProjectId, composerSessionKey])

  useEffect(() => {
    persistComposerDraft(getComposerDraftStorageKey(composerSessionKey), draft)
  }, [composerSessionKey, draft])

  useEffect(() => {
    resizeComposerTextarea(composerTextareaRef.current)
  }, [draft])

  useEffect(() => {
    const flushChatChunks = () => {
      chatChunkFlushTimerRef.current = null
      const chunks = coalesceChatChunks(pendingChatChunksRef.current.splice(0))
      if (chunks.length === 0) return

      setConversations((current) => {
        let next = current

        for (const chunk of chunks) {
          const index = next.findIndex((conversation) => conversation.id === chunk.conversationId)
          const source = index >= 0
            ? next[index]
            : streamingConversationDraftsRef.current[chunk.conversationId]
          if (!source) continue

          const updatedConversation = applyChatChunkToConversation(source, chunk)
          streamingConversationDraftsRef.current[chunk.conversationId] = updatedConversation
          if (chunk.done) void window.gllm.saveConversation(updatedConversation)
          if (index < 0 && updatedConversation.projectId !== activeProjectIdRef.current) continue

          if (index >= 0) {
            if (next === current) next = [...current]
            next[index] = updatedConversation
          } else {
            next = [updatedConversation, ...next.filter((conversation) => conversation.id !== chunk.conversationId)]
          }
        }

        return next
      })

      for (const chunk of chunks) {
        if (!chunk.done) continue
        delete streamingConversationDraftsRef.current[chunk.conversationId]
        if (chunk.targetMessageId) {
          setTranslatingMessageIds((current) => current.filter((id) => id !== chunk.targetMessageId))
        } else {
          completeConversationRun(chunk.conversationId, chunk.error ? 'error' : 'completed')
        }
        if (chunk.warning) showToolNotice(chunk.warning, 9000)
      }
    }

    const unsubscribe = window.gllm.onChatChunk((chunk) => {
      pendingChatChunksRef.current.push(chunk)
      if (chunk.done) {
        if (chatChunkFlushTimerRef.current !== null) window.clearTimeout(chatChunkFlushTimerRef.current)
        flushChatChunks()
      } else if (chatChunkFlushTimerRef.current === null) {
        chatChunkFlushTimerRef.current = window.setTimeout(flushChatChunks, 32)
      }
    })

    return () => {
      unsubscribe()
      if (chatChunkFlushTimerRef.current !== null) window.clearTimeout(chatChunkFlushTimerRef.current)
      pendingChatChunksRef.current = []
    }
  }, [])

  useEffect(() => {
    return window.gllm.onChatActivity((activity) => {
      if (activity.active) {
        beginConversationRun(activity.conversationId)
      } else {
        completeConversationRun(activity.conversationId, activity.error ? 'error' : 'completed')
      }
    })
  }, [])

  useEffect(() => {
    return window.gllm.onConversationChanged((change) => {
      if (change.action === 'deleted') {
        delete streamingConversationDraftsRef.current[change.conversationId]
        discardConversationRun(change.conversationId)
        const mergedConversations = (change.conversations ?? []).map(
          (conversation) => streamingConversationDraftsRef.current[conversation.id] ?? conversation
        )
        for (const draftConversation of Object.values(streamingConversationDraftsRef.current)) {
          if (draftConversation.projectId !== activeProjectIdRef.current) continue
          if (!mergedConversations.some((conversation) => conversation.id === draftConversation.id)) {
            mergedConversations.push(draftConversation)
          }
        }
        setConversations(mergedConversations)
        setActiveConversationId((current) => {
          if (current !== change.conversationId) return current

          const next = sortConversationsForSidebar(
            mergedConversations.filter((conversation) => conversation.assistantId === activeAssistantId)
          )[0]
          activeConversationIdRef.current = next?.id ?? null
          return next?.id ?? null
        })
        return
      }

      const changedConversation = streamingConversationDraftsRef.current[change.conversationId] ?? change.conversation
      if (!changedConversation || changedConversation.projectId !== activeProjectIdRef.current) return
      setConversations((current) => mergeConversationChange(current, change, changedConversation))

      if (change.action === 'metadata') return

      if (activeConversationIdRef.current && activeConversationIdRef.current !== change.conversationId) return

      setActiveAssistantId(changedConversation.assistantId)
      selectConversation(change.conversationId)
    })
  }, [activeAssistantId])

  useEffect(() => {
    if (!selectionMenu && !imageAttachmentMenu && !workspaceArtifactMenu && !assistantContextMenu && !conversationContextMenu) return

    const closeMenu = () => {
      setSelectionMenu(null)
      setImageAttachmentMenu(null)
      setWorkspaceArtifactMenu(null)
      setAssistantContextMenu(null)
      setConversationContextMenu(null)
    }
    const closeMenuOnPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.selection-context-menu')) return
      closeMenu()
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('pointerdown', closeMenuOnPointerDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeMenuOnPointerDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [selectionMenu, imageAttachmentMenu, workspaceArtifactMenu, assistantContextMenu, conversationContextMenu])

  useEffect(() => window.gllm.onLocalTaskProgress(setLocalTaskProgress), [])

  useEffect(
    () => window.gllm.onWorkspaceAgentProgress((progress) => {
      setWorkspaceActivitiesByConversation((current) => {
        const activities = current[progress.conversationId] ?? []
        const existing = activities.findIndex((activity) => activity.id === progress.activity.id)
        const next = existing < 0
          ? [...activities, progress.activity]
          : activities.map((activity, index) => index === existing ? progress.activity : activity)
        workspaceActivitiesRef.current[progress.conversationId] = next
        return { ...current, [progress.conversationId]: next }
      })
    }),
    []
  )

  useEffect(
    () => window.gllm.onWorkspaceApprovalRequested((prompt) => {
      setWorkspaceApprovalPrompts((current) => [
        ...current.filter((item) => item.id !== prompt.id),
        prompt
      ])
    }),
    []
  )

  useEffect(() => {
    setEditingMessageId(null)
    setEditingMessageContent('')
    setMessageAutoFollow(true)
    setIsNearMessageBottom(true)
    window.requestAnimationFrame(() => scrollToLatest('auto', { resumeAutoFollow: true }))
  }, [activeConversationId])

  useEffect(() => {
    if (!isStreaming || workspaceActivities.length === 0) return
    window.requestAnimationFrame(() => scrollToLatest('smooth', { requireAutoFollow: true }))
  }, [workspaceActivities])

  useEffect(() => {
    const composer = composerRef.current
    if (!composer) return

    const updateHeight = () => setComposerHeight(composer.getBoundingClientRect().height)
    updateHeight()
    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(composer)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!autoFollowMessages) return
    window.requestAnimationFrame(() => scrollToLatest(isStreaming ? 'auto' : 'smooth', { requireAutoFollow: true, resumeAutoFollow: false }))
  }, [
    autoFollowMessages,
    isStreaming,
    activeConversation?.messages.length,
    activeConversation?.messages.at(-1)?.content,
    activeConversationTranslationSignature
  ])

  function showToolNotice(
    message: string,
    duration = 2600,
    options: {
      emphasis?: boolean
      requiresConfirmation?: boolean
      conversationId?: string
      settingsTab?: SettingsTab
    } = {}
  ) {
    setToolNotice({
      message,
      emphasis: Boolean(options.emphasis),
      requiresConfirmation: Boolean(options.requiresConfirmation),
      conversationId: options.conversationId,
      settingsTab: options.settingsTab
    })
    if (toolNoticeTimerRef.current) window.clearTimeout(toolNoticeTimerRef.current)
    toolNoticeTimerRef.current = null
    if (!options.requiresConfirmation) {
      toolNoticeTimerRef.current = window.setTimeout(() => setToolNotice(null), duration)
    }
  }

  function dismissToolNotice() {
    if (toolNoticeTimerRef.current) window.clearTimeout(toolNoticeTimerRef.current)
    toolNoticeTimerRef.current = null
    setToolNotice(null)
  }

  function openToolNoticeSettings(tab: SettingsTab) {
    dismissToolNotice()
    setSettingsInitialTab(tab)
    setSettingsOpen(true)
  }

  function openToolNoticeConversation(conversationId: string) {
    const conversation = conversations.find((item) => item.id === conversationId)
    if (!conversation) {
      showToolNotice(t('notices.conversationMissing'), 3200, { emphasis: true })
      return
    }
    setDraftWorkspace(undefined)
    setActiveAssistantId(conversation.assistantId)
    selectConversation(conversation.id)
    dismissToolNotice()
    window.requestAnimationFrame(() => scrollToLatest('auto', { resumeAutoFollow: true }))
  }

  function clearSpaceTransientState() {
    newConversationDraftRef.current = null
    setAssistantSearchQuery('')
    setSelectionMenu(null)
    setImageAttachmentMenu(null)
  }

  async function switchSpace(spaceId: string) {
    if (!spaceId || spaceId === activeProjectId) return

    const state = await window.gllm.setActiveProjectId(spaceId)
    applyAppState(state, { selectFirstConversation: true })
    clearSpaceTransientState()
    showToolNotice(t('notices.spaceSwitched', { space: getSpaceName(state.projects.find((project) => project.id === state.activeProjectId) ?? null) }))
  }

  async function runConversationSearch(query = conversationSearchQuery) {
    const normalizedQuery = query.trim().slice(0, 300)
    const requestId = conversationSearchRequestRef.current + 1
    conversationSearchRequestRef.current = requestId
    setConversationSearchQuery(normalizedQuery)
    setConversationSearchOpen(true)
    setConversationSearchLoading(true)
    setConversationSearchError('')
    setConversationSearchResponse(null)

    try {
      const response = await window.gllm.searchConversations({
        query: normalizedQuery,
        provider: activeProvider,
        limit: 20
      })
      if (conversationSearchRequestRef.current !== requestId) return
      setConversationSearchResponse(response)
    } catch (error) {
      if (conversationSearchRequestRef.current !== requestId) return
      setConversationSearchError(error instanceof Error ? error.message : t('notices.conversationSearchFailed'))
    } finally {
      if (conversationSearchRequestRef.current === requestId) setConversationSearchLoading(false)
    }
  }

  async function openConversationSearchResult(result: ConversationSearchResult) {
    try {
      if (result.projectId !== activeProjectId) {
        const state = await window.gllm.setActiveProjectId(result.projectId)
        applyAppState(state)
        clearSpaceTransientState()
      }
      setActiveAssistantId(result.assistantId)
      selectConversation(result.conversationId)
      setAssistantSearchQuery('')
      setConversationSearchOpen(false)
      showToolNotice(t('notices.conversationOpened', { title: result.title }))
    } catch (error) {
      setConversationSearchError(error instanceof Error ? error.message : t('notices.conversationOpenFailed'))
    }
  }

  async function createSpace(payload: SpaceFormPayload) {
    const name = payload.name.trim()
    if (!name) return

    const now = Date.now()
    const { saved } = await window.gllm.saveProject({
      id: createId('space'),
      name,
      description: payload.description.trim() || undefined,
      logoDataUrl: payload.logoDataUrl,
      workspacePath: payload.workspacePath,
      workspacePermission: payload.workspacePath ? 'read-write' : undefined,
      createdAt: now,
      updatedAt: now
    })
    const nextState = await window.gllm.setActiveProjectId(saved.id)
    applyAppState(nextState, { selectFirstConversation: true })
    clearSpaceTransientState()
    showToolNotice(t('notices.spaceCreated', { space: saved.name }))
  }

  async function renameSpace(spaceId: string, payload: SpaceFormPayload) {
    const space = projects.find((project) => project.id === spaceId)
    const name = payload.name.trim()
    if (!space || !name) return

    const { saved, state } = await window.gllm.saveProject({
      ...space,
      name,
      description: payload.description.trim() || undefined,
      logoDataUrl: space.id === defaultSpaceId ? undefined : payload.logoDataUrl,
      workspacePath: payload.workspacePath,
      workspacePermission: payload.workspacePath ? 'read-write' : undefined,
      updatedAt: Date.now()
    })
    applyAppState(state)
    showToolNotice(t('notices.spaceRenamed', { space: saved.name }))
  }

  function getDistanceToMessageBottom() {
    const list = listRef.current
    if (!list) return 0
    return list.scrollHeight - list.scrollTop - list.clientHeight
  }

  function setMessageAutoFollow(enabled: boolean) {
    autoFollowMessagesRef.current = enabled
    setAutoFollowMessages(enabled)
  }

  function pauseMessageAutoFollow() {
    setSelectionMenu(null)
    setIsNearMessageBottom(false)
    setMessageAutoFollow(false)
  }

  function handleMessageWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const list = listRef.current
    if (event.deltaY < 0 && list && list.scrollTop > 0) pauseMessageAutoFollow()
  }

  function updateMessageScrollState() {
    setSelectionMenu(null)
    const distanceToBottom = getDistanceToMessageBottom()
    const isAtBottom = distanceToBottom <= 4
    const isNearBottom = distanceToBottom <= bottomFollowThreshold

    if (!autoFollowMessagesRef.current) {
      setIsNearMessageBottom(isAtBottom)
      if (isAtBottom) setMessageAutoFollow(true)
      return
    }

    setIsNearMessageBottom(isNearBottom)
    setMessageAutoFollow(isNearBottom)
  }

  function scrollToLatest(
    behavior: ScrollBehavior = 'smooth',
    options: { requireAutoFollow?: boolean; resumeAutoFollow?: boolean } = {}
  ) {
    if (options.requireAutoFollow && !autoFollowMessagesRef.current) return

    const list = listRef.current
    if (!list) return
    list.scrollTo({ top: list.scrollHeight, behavior })
    if (options.resumeAutoFollow ?? true) {
      setIsNearMessageBottom(true)
      setMessageAutoFollow(true)
    }
  }

  async function pickComposerAttachments(kind: AttachmentKind) {
    if (isPickingAttachment) return

    setIsPickingAttachment(true)
    try {
      const picked = await window.gllm.pickAttachments(kind)
      if (picked.length === 0) return

      setPendingAttachments((current) => [...current, ...picked].slice(0, 8))
      const unreadableCount = picked.filter((attachment) => attachment.kind === 'file' && !attachment.text).length
      const imageWithoutDataCount = picked.filter((attachment) => attachment.kind === 'image' && !attachment.dataUrl).length

      if (imageWithoutDataCount) {
        showToolNotice(t('notices.attachmentsImageUnreadable'))
      } else if (unreadableCount) {
        showToolNotice(t('notices.attachmentsTextUnreadable'))
      } else {
        showToolNotice(t('notices.attachmentsAdded', { count: picked.length }))
      }
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('notices.attachmentPickFailed'))
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  function openImageAttachmentMenu(event: ReactMouseEvent, attachment: PreparedAttachment) {
    if (attachment.kind !== 'image' || !attachment.dataUrl) return

    event.preventDefault()
    event.stopPropagation()
    setSelectionMenu(null)
    setImageAttachmentMenu({
      x: Math.min(event.clientX, window.innerWidth - 156),
      y: Math.min(event.clientY, window.innerHeight - 94),
      attachment
    })
  }

  async function copyImageAttachmentToClipboard() {
    if (!imageAttachmentMenu?.attachment.dataUrl) return

    try {
      await window.gllm.copyImageToClipboard(imageAttachmentMenu.attachment.dataUrl)
      showToolNotice(t('notices.imageCopied'))
    } catch {
      showToolNotice(t('notices.imageCopyFailed'))
    } finally {
      setImageAttachmentMenu(null)
    }
  }

  async function handleComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = getClipboardFiles(event.clipboardData).slice(0, 8)
    if (files.length === 0) return

    event.preventDefault()
    if (isPickingAttachment) return

    setIsPickingAttachment(true)
    try {
      const inputs: ClipboardAttachmentInput[] = await Promise.all(
        files.map(async (file, index) => {
          const mimeType = file.type || 'application/octet-stream'
          const extension = getFileExtensionFromMime(mimeType)
          const name = file.name || `${t(mimeType.startsWith('image/') ? 'notices.pastedImageName' : 'notices.pastedAttachmentName', { index: index + 1 })}.${extension}`
          const canReadContent = file.size <= maxPastedAttachmentBytes

          return {
            name,
            mimeType,
            size: file.size,
            kind: mimeType.startsWith('image/') ? 'image' : 'file',
            dataUrl: canReadContent ? await readFileAsDataUrl(file) : undefined
          }
        })
      )
      const pasted = await window.gllm.preparePastedAttachments(inputs)
      if (pasted.length === 0) return

      setPendingAttachments((current) => [...current, ...pasted].slice(0, 8))
      const imageCount = pasted.filter((attachment) => attachment.kind === 'image').length
      const unreadableCount = pasted.filter((attachment) => attachment.kind === 'file' && !attachment.text).length
      const imageWithoutDataCount = pasted.filter((attachment) => attachment.kind === 'image' && !attachment.dataUrl).length

      if (imageWithoutDataCount > 0) {
        showToolNotice(t('notices.clipboardImageUnreadable'))
      } else if (unreadableCount > 0) {
        showToolNotice(t('notices.clipboardTextUnreadable'))
      } else if (imageCount > 0) {
        showToolNotice(t('notices.clipboardAttachmentsWithImages', { count: pasted.length }))
      } else {
        showToolNotice(t('notices.clipboardAttachmentsAdded', { count: pasted.length }))
      }
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('notices.clipboardAttachmentFailed'))
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function referenceKnowledgeNote(note: KnowledgeNote) {
    const reference: KnowledgeReference = {
      id: note.id,
      title: note.title,
      content: note.content
    }

    setPendingKnowledgeRefs((current) => {
      if (current.some((item) => item.id === reference.id)) return current
      return [...current, reference].slice(0, 8)
    })
    showToolNotice(t('notices.knowledgeReferenced', { title: note.title }))
  }

  function removePendingKnowledgeRef(id: string) {
    setPendingKnowledgeRefs((current) => current.filter((reference) => reference.id !== id))
  }

  function addQuoteReference(content: string) {
    const normalized = content.replace(/\r\n/g, '\n').trim()
    if (!normalized) return

    setPendingQuoteRefs((current) => {
      if (current.some((reference) => reference.content.trim() === normalized)) return current

      return [
        ...current,
        {
          id: createId('quote'),
          title: getQuoteReferenceTitle(normalized),
          content: normalized
        }
      ].slice(-6)
    })
  }

  function removePendingQuoteRef(id: string) {
    setPendingQuoteRefs((current) => current.filter((reference) => reference.id !== id))
  }

  async function captureComposerScreenshot() {
    if (isPickingAttachment) return

    setIsPickingAttachment(true)
    try {
      showToolNotice(t('notices.screenshotOpened'))
      const screenshot = await window.gllm.captureScreenshot()
      if (!screenshot) {
        showToolNotice(t('notices.noScreenshot'))
        return
      }

      setPendingAttachments((current) => [...current, screenshot].slice(0, 8))
      showToolNotice(screenshot.dataUrl ? t('notices.screenshotAdded') : t('notices.screenshotUnreadable'))
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('notices.screenshotFailed'))
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function openAssistant(assistant: Assistant) {
    setDraftWorkspace(undefined)
    setActiveAssistantId(assistant.id)
    const existing = sortConversationsForSidebar(
      conversations.filter((conversation) => conversation.assistantId === assistant.id)
    )[0]
    selectConversation(existing?.id ?? null)
  }

  function openAssistantContextMenu(event: ReactMouseEvent, assistant: Assistant) {
    event.preventDefault()
    event.stopPropagation()
    const menuHeight = 126
    setAssistantContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 8),
      assistantId: assistant.id
    })
  }

  function openConversationContextMenu(event: ReactMouseEvent, conversation: Conversation) {
    event.preventDefault()
    event.stopPropagation()
    const menuHeight = 86
    setConversationContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 8),
      conversationId: conversation.id
    })
  }

  async function toggleConversationPin(conversation: Conversation) {
    setConversationContextMenu(null)
    const saved = await window.gllm.setConversationPinned(conversation.id, !conversation.pinnedAt)
    setConversations((current) => current.map((item) => (item.id === saved.id ? saved : item)))
  }

  async function setAssistantHidden(assistant: Assistant, hidden: boolean) {
    setAssistantContextMenu(null)
    if (hidden && visibleAssistants.length <= 1) {
      window.alert(t('assistantActions.keepOneVisible'))
      return
    }

    const saved = await window.gllm.saveAssistant({ ...assistant, hidden })
    const nextAssistants = assistants.map((item) => (item.id === saved.id ? saved : item))
    setAssistants(nextAssistants)
    if (!hidden && nextAssistants.every((item) => !item.hidden)) setHiddenAssistantsOpen(false)

    if (hidden && activeAssistantId === saved.id) {
      const replacement = sortAssistantsForSidebar(
        nextAssistants.filter((item) => !item.hidden),
        conversations
      )[0]
      if (replacement) openAssistant(replacement)
    }
  }

  async function deleteAssistantWithConfirmation(assistant: Assistant) {
    setAssistantContextMenu(null)
    if (!assistant.hidden && visibleAssistants.length <= 1) {
      window.alert(t('assistantActions.keepOneVisible'))
      return
    }

    const conversationCount = conversations.filter((conversation) => conversation.assistantId === assistant.id).length
    const displayAssistant = localizeAssistant(assistant)
    const confirmed = window.confirm(
      t('assistantActions.deleteConfirm', { name: displayAssistant.name, count: conversationCount })
    )
    if (!confirmed) return

    const wasActive = activeAssistantId === assistant.id
    for (const conversation of conversations.filter((item) => item.assistantId === assistant.id)) {
      window.gllm.cancelResponse(conversation.id)
      delete streamingConversationDraftsRef.current[conversation.id]
      discardConversationRun(conversation.id)
    }
    const state = await window.gllm.deleteAssistant(assistant.id)
    applyAppState(state)

    if (wasActive) {
      const replacement = sortAssistantsForSidebar(
        state.assistants.filter((item) => !item.hidden),
        state.conversations
      )[0]
      if (replacement) {
        setActiveAssistantId(replacement.id)
        const nextConversation = sortConversationsForSidebar(
          state.conversations.filter((conversation) => conversation.assistantId === replacement.id)
        )[0]
        selectConversation(nextConversation?.id ?? null)
      }
    }

    if (state.assistants.every((item) => !item.hidden)) setHiddenAssistantsOpen(false)
  }

  function startNewChat() {
    const selectedConversation = conversations.find((conversation) => conversation.id === activeConversationIdRef.current)
    if (selectedConversation?.assistantId === activeAssistant.id && selectedConversation.messages.length === 0) {
      showToolNotice(t('notices.blankConversationReady'))
      window.requestAnimationFrame(() => composerTextareaRef.current?.focus())
      return
    }

    const pendingDraft = newConversationDraftRef.current
    if (
      pendingDraft?.assistantId === activeAssistant.id &&
      pendingDraft.projectId === activeProjectId
    ) {
      selectConversation(pendingDraft.id)
      showToolNotice(t('notices.blankConversationReady'))
      window.requestAnimationFrame(() => composerTextareaRef.current?.focus())
      return
    }

    const reusableDraft = sortConversationsForSidebar(
      conversations.filter((conversation) =>
        conversation.assistantId === activeAssistant.id &&
        conversation.projectId === activeProjectId &&
        isPristineConversationDraft(conversation)
      )
    )[0]
    if (reusableDraft) {
      newConversationDraftRef.current = {
        id: reusableDraft.id,
        assistantId: reusableDraft.assistantId,
        projectId: reusableDraft.projectId
      }
      setDraftWorkspace(undefined)
      selectConversation(reusableDraft.id)
      showToolNotice(t('notices.blankConversationReady'))
      window.requestAnimationFrame(() => composerTextareaRef.current?.focus())
      return
    }

    const conversation = createConversation(activeAssistant, assistantDefaultProvider, activeProjectId)
    newConversationDraftRef.current = {
      id: conversation.id,
      assistantId: conversation.assistantId,
      projectId: conversation.projectId
    }
    setDraftWorkspace(undefined)
    setConversations((current) => [conversation, ...current])
    selectConversation(conversation.id)
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus())
  }

  function openConversationModelSettings() {
    if (activeConversation) {
      setConversationModelOpen(true)
      return
    }

    const conversation = attachDraftWorkspace(
      createConversation(activeAssistant, assistantDefaultProvider, activeProjectId),
      draftWorkspace
    )
    setConversations((current) => [conversation, ...current])
    moveComposerSessionToConversation(conversation.id)
    selectConversation(conversation.id)
    void window.gllm.saveConversation(conversation)
    setDraftWorkspace(undefined)
    setConversationModelOpen(true)
  }

  async function removeConversation(id: string) {
    setConversationContextMenu(null)
    if (newConversationDraftRef.current?.id === id) newConversationDraftRef.current = null
    window.gllm.cancelResponse(id)
    delete streamingConversationDraftsRef.current[id]
    discardConversationRun(id)
    clearWorkspaceActivities(id)
    setWorkspaceApprovalPrompts((current) => current.filter((prompt) => prompt.conversationId !== id))
    const sessionKey = getComposerSessionKey(id, activeProjectId, activeAssistantId)
    setComposerDrafts((current) => {
      const next = { ...current }
      delete next[sessionKey]
      return next
    })
    setComposerAttachments((current) => {
      const next = { ...current }
      delete next[sessionKey]
      return next
    })
    setComposerQuoteRefs((current) => {
      const next = { ...current }
      delete next[sessionKey]
      return next
    })
    setComposerKnowledgeRefs((current) => {
      const next = { ...current }
      delete next[sessionKey]
      return next
    })
    persistComposerDraft(getComposerDraftStorageKey(sessionKey), '')
    const nextConversations = conversations.filter((conversation) => conversation.id !== id)
    setConversations(nextConversations)
    if (activeConversationId === id) {
      const next = sortConversationsForSidebar(
        nextConversations.filter((conversation) => conversation.assistantId === activeAssistantId)
      )[0]
      selectConversation(next?.id ?? null)
    }
    await window.gllm.deleteConversation(id)
  }

  function saveConversationUpdate(conversation: Conversation) {
    const nextConversation = withConversationTokens({ ...conversation, projectId: conversation.projectId ?? activeProjectId })
    streamingConversationDraftsRef.current = syncConversationUpdateIntoStreamingDrafts(
      streamingConversationDraftsRef.current,
      nextConversation
    )
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    void window.gllm.saveConversation(nextConversation)
  }

  function changeActiveConversationModel(modelId: string) {
    const nextModelId = modelId.trim()
    if (!nextModelId) return
    if (activeConversation?.modelProviderId === conversationProvider.id && activeConversation.modelId === nextModelId) return

    const conversation = activeConversation ?? attachDraftWorkspace(
      createConversation(activeAssistant, conversationProvider, activeProjectId),
      draftWorkspace
    )
    const nextConversation: Conversation = {
      ...conversation,
      modelProviderId: conversationProvider.id,
      modelId: nextModelId,
      updatedAt: Date.now()
    }

    saveConversationUpdate(nextConversation)
    if (!activeConversation) {
      setDraftWorkspace(undefined)
      moveComposerSessionToConversation(nextConversation.id)
      selectConversation(nextConversation.id)
    }
    showToolNotice(t('notices.modelSwitched', { provider: conversationProvider.name, model: nextModelId }))
  }

  function changeActiveConversationReasoningEffort(reasoningEffort: ReasoningEffort) {
    if (activeConversation?.reasoningEffort === reasoningEffort) return

    const conversation = activeConversation ?? attachDraftWorkspace(
      createConversation(activeAssistant, conversationProvider, activeProjectId),
      draftWorkspace
    )
    const nextConversation: Conversation = {
      ...conversation,
      reasoningEffort,
      updatedAt: Date.now()
    }

    saveConversationUpdate(nextConversation)
    if (!activeConversation) {
      setDraftWorkspace(undefined)
      moveComposerSessionToConversation(nextConversation.id)
      selectConversation(nextConversation.id)
    }
  }

  function changeActiveConversationModelAndReasoning(modelId: string, reasoningEffort: ReasoningEffort) {
    const nextModelId = modelId.trim()
    if (!nextModelId) return

    const conversation = activeConversation ?? attachDraftWorkspace(
      createConversation(activeAssistant, conversationProvider, activeProjectId),
      draftWorkspace
    )
    const nextConversation: Conversation = {
      ...conversation,
      modelProviderId: conversationProvider.id,
      modelId: nextModelId,
      reasoningEffort,
      updatedAt: Date.now()
    }

    saveConversationUpdate(nextConversation)
    if (!activeConversation) {
      setDraftWorkspace(undefined)
      moveComposerSessionToConversation(nextConversation.id)
      selectConversation(nextConversation.id)
    }
  }

  async function changeActiveConversationWebSearchMode(nextMode: WebSearchMode) {
    if (!settings || webSearchMode === nextMode) return

    await saveSettings({ ...settings, webSearchMode: nextMode })
    const labelKey = nextMode === 'auto'
      ? 'app.webSearchModeAuto'
      : nextMode === 'on'
        ? 'app.webSearchModeOn'
        : 'app.webSearchModeOff'
    showToolNotice(t('app.webSearchModeChanged', { mode: t(labelKey) }))
  }

  function getSelectedTextForMessage(messageId: string): string {
    return getMessageSelectionForMessage(messageId)?.text ?? ''
  }

  function getMessageSelectionForMessage(messageId: string): MessageSelectionSnapshot | null {
    return getMessageSelectionSnapshot(document.querySelector(`[data-message-id="${messageId}"]`))
  }

  async function copyMessage(content: string) {
    try {
      await writePlainTextToClipboard(content)
      showToolNotice(t('notices.markdownCopied'))
    } catch {
      showToolNotice(t('notices.copyFailed'))
    }
  }

  function quoteMessage(message: ChatMessage) {
    const selectedText = getSelectedTextForMessage(message.id)
    addQuoteReference(selectedText || message.content)
    showToolNotice(selectedText ? t('notices.selectionQuoted') : t('notices.messageQuoted'))
  }

  function openSelectionContextMenu(event: ReactMouseEvent, message: ChatMessage) {
    const selection = getMessageSelectionForMessage(message.id)
    if (!selection) {
      setSelectionMenu(null)
      return
    }

    event.preventDefault()
    setSelectionMenu({
      x: Math.min(event.clientX, window.innerWidth - 156),
      y: Math.min(event.clientY, window.innerHeight - 94),
      text: selection.text,
      html: selection.html
    })
  }

  async function copySelectionMenuText() {
    if (!selectionMenu) return

    try {
      await writeRichTextToClipboard(selectionMenu)
      showToolNotice(t('notices.richTextCopied'))
    } catch {
      showToolNotice(t('notices.copyFailed'))
    } finally {
      setSelectionMenu(null)
    }
  }

  function quoteSelectionMenuText() {
    if (!selectionMenu) return
    addQuoteReference(selectionMenu.text)
    setSelectionMenu(null)
    showToolNotice(t('notices.selectionQuoted'))
  }

  async function saveMessageToNote(message: ChatMessage) {
    if (!activeConversation) return

    const content = [message.content, message.translation ? `${t('notices.translationLabel')}:\n${message.translation}` : ''].filter(Boolean).join('\n\n')
    const title = content
      .split('\n')
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 36) || t('notices.chatNote')
    const now = Date.now()
    const saved = await window.gllm.saveNote({
      id: createId('note'),
      projectId: activeProjectId,
      title,
      content,
      assistantId: activeAssistant.id,
      conversationId: activeConversation.id,
      messageId: message.id,
      createdAt: now,
      updatedAt: now
    })

    setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)])
    showToolNotice(t('notices.savedToKnowledge'))
  }

  async function deleteNote(id: string) {
    await window.gllm.deleteNote(id)
    setNotes((current) => current.filter((note) => note.id !== id))
  }

  async function saveAssistantMemory(memory: AssistantMemory) {
    const saved = await window.gllm.saveMemory({ ...memory, projectId: memory.projectId ?? activeProjectId })
    setMemories((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    return saved
  }

  async function deleteAssistantMemory(id: string) {
    await window.gllm.deleteMemory(id)
    setMemories((current) => current.filter((memory) => memory.id !== id))
  }

  async function saveToolConfig(tool: ToolConfig) {
    const saved = await window.gllm.saveTool({ ...tool, projectId: tool.projectId ?? activeProjectId })
    setTools((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    return saved
  }

  async function deleteToolConfig(id: string) {
    await window.gllm.deleteTool(id)
    setTools((current) => current.filter((tool) => tool.id !== id))
  }

  function translateMessage(message: ChatMessage) {
    if (!settings || !activeConversation) return
    if (isStreaming) {
      showToolNotice(t('notices.translateAfterResponse'))
      return
    }
    if (translatingMessageIds.includes(message.id)) return
    if (needsApiKey) {
      setSettingsOpen(true)
      return
    }

    const source = message.content.trim()
    if (!source) return

    const nextConversation: Conversation = withConversationTokens({
      ...activeConversation,
      messages: activeConversation.messages.map((item) => (item.id === message.id ? { ...item, translation: '' } : item)),
      updatedAt: Date.now()
    })
    const translationAssistant: Assistant = {
      ...activeAssistant,
      id: `${activeAssistant.id}_translator`,
      name: '翻译助手',
      title: '消息翻译',
      tone: '准确、自然',
      systemPrompt:
        '你是专业翻译助手。请只输出译文，不要解释，不要添加标题。如果原文是中文，翻译成自然英文；如果原文不是中文，翻译成自然中文。保留原文的段落结构、列表结构和专有名词。'
    }

    setTranslatingMessageIds((current) => (current.includes(message.id) ? current : [...current, message.id]))
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: translationAssistant,
      provider: conversationProvider,
      messages: [createMessage('user', source)],
      settings,
      purpose: 'translation',
      targetMessageId: message.id
    })
  }

  function deleteMessage(messageId: string) {
    if (!activeConversation) return

    const messages = activeConversation.messages.filter((message) => message.id !== messageId)
    const firstUserMessage = messages.find((message) => message.role === 'user')
    const nextConversation: Conversation = {
      ...activeConversation,
      title: firstUserMessage?.content.slice(0, 28) || activeConversation.title,
      messages,
      updatedAt: Date.now()
    }

    saveConversationUpdate(nextConversation)
    showToolNotice(t('notices.messageDeleted'))
  }

  function editMessage(message: ChatMessage) {
    if (isStreaming || message.role !== 'user') return
    setEditingMessageId(message.id)
    setEditingMessageContent(message.content)
  }

  function cancelMessageEdit() {
    setEditingMessageId(null)
    setEditingMessageContent('')
  }

  function resendEditedMessage(messageId: string) {
    if (!settings || isStreaming || !activeConversation) return
    if (needsApiKey) {
      setSettingsOpen(true)
      return
    }

    const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId)
    const originalMessage = activeConversation.messages[messageIndex]
    const content = editingMessageContent.trim()
    if (messageIndex < 0 || originalMessage?.role !== 'user' || !content) return

    const editedMessage = createMessage(
      'user',
      content,
      originalMessage.attachments,
      originalMessage.knowledgeRefs
    )
    const editedBranch = replaceUserMessageBranch(activeConversation, messageId, editedMessage)
    if (!editedBranch) return
    const { messages, projectMemory } = editedBranch
    const firstUserMessage = messages.find((message) => message.role === 'user')
    const nextConversation = withConversationTokens({
      ...activeConversation,
      title: firstUserMessage?.content.slice(0, 28) || activeConversation.title,
      messages,
      projectMemory,
      updatedAt: Date.now()
    })

    cancelMessageEdit()
    beginConversationRun(nextConversation.id)
    setMessageAutoFollow(true)
    saveConversationUpdate(nextConversation)
    if (nextConversation.workspace) {
      void executeWorkspaceConversation(nextConversation, nextConversation.workspace, conversationProvider)
      return
    }
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: activeAssistant,
      assistantMemories: enabledAssistantMemories,
      projectMemory: nextConversation.projectMemory,
      provider: conversationProvider,
      messages: nextConversation.messages,
      settings,
      reasoningEffort: nextConversation.reasoningEffort,
      ...getWebSearchRequestSettings(webSearchMode, nextConversation)
    })
  }

  async function executeWorkspaceConversation(
    nextConversation: Conversation,
    workspace: ConversationWorkspace,
    provider: ApiProvider,
    retryAttempts: MessageRetryAttempt[] = []
  ) {
    if (!settings) return
    const conversationId = nextConversation.id
    clearWorkspaceActivities(conversationId)
    let outcome: 'completed' | 'error' = 'completed'
    try {
      const result = await window.gllm.runWorkspaceAgent({
        conversationId: nextConversation.id,
        workspace,
        provider,
        messages: nextConversation.messages,
        settings,
        reasoningEffort: nextConversation.reasoningEffort,
        ...getWebSearchRequestSettings(webSearchMode, nextConversation),
        projectMemory: nextConversation.projectMemory
      })
      const assistantMessage: ChatMessage = {
        ...createMessage('assistant', result.content),
        workspaceActivities: result.activities,
        workspaceChangedFiles: result.changedFiles,
        workspaceArtifactRoot: workspace.rootPath,
        contextSavings: result.contextSavings,
        retryAttempts: retryAttempts.length > 0 ? retryAttempts : undefined
      }
      const completedConversation = withConversationTokens({
        ...nextConversation,
        workspace,
        messages: [...nextConversation.messages, assistantMessage],
        updatedAt: Date.now()
      })
      setConversations((current) => [completedConversation, ...current.filter((item) => item.id !== completedConversation.id)])
      void window.gllm.saveConversation(completedConversation)
      if (result.changedFiles.length > 0) showToolNotice(t('workspace.filesChanged', { count: result.changedFiles.length }))
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : t('workspaceErrors.unknown')
      if (/任务已停止|AbortError|aborted/i.test(rawMessage)) {
        showToolNotice(t('workspace.generationStopped'))
        return
      }
      outcome = 'error'
      const message = formatWorkspaceError(rawMessage)
      const currentActivities = workspaceActivitiesRef.current[conversationId] ?? []
      const currentAttempt: MessageRetryAttempt = {
        attemptedAt: Date.now(),
        error: message,
        activities: currentActivities
      }
      const failedConversation = withConversationTokens({
        ...nextConversation,
        workspace,
        messages: [...nextConversation.messages, {
          ...createMessage('assistant', t('workspace.taskFailed', { message })),
          error: message,
          workspaceActivities: currentActivities,
          workspaceArtifactRoot: workspace.rootPath,
          retryAttempts: [...retryAttempts, currentAttempt]
        }],
        updatedAt: Date.now()
      })
      setConversations((current) => [failedConversation, ...current.filter((item) => item.id !== failedConversation.id)])
      void window.gllm.saveConversation(failedConversation)
    } finally {
      setWorkspaceApprovalPrompts((current) => current.filter((prompt) => prompt.conversationId !== conversationId))
      completeConversationRun(conversationId, outcome)
    }
  }

  function regenerateMessage(messageId: string) {
    if (!settings || isStreaming || !activeConversation) return
    if (needsApiKey) {
      setSettingsOpen(true)
      return
    }

    const messageIndex = activeConversation.messages.findIndex((message) => message.id === messageId)
    if (messageIndex <= 0) {
      showToolNotice(t('notices.noRegenerateContext'))
      return
    }

    const message = activeConversation.messages[messageIndex]
    const messages = activeConversation.messages.slice(0, messageIndex)
    if (!messages.some((message) => message.role === 'user')) {
      showToolNotice(t('notices.noUserQuestion'))
      return
    }

    const nextConversation: Conversation = {
      ...activeConversation,
      messages,
      updatedAt: Date.now()
    }

    beginConversationRun(nextConversation.id)
    saveConversationUpdate(nextConversation)
    if (activeConversation.workspace) {
      const retryAttempts: MessageRetryAttempt[] = message.error
        ? message.retryAttempts?.length
          ? message.retryAttempts
          : [{ attemptedAt: message.createdAt, error: formatWorkspaceError(message.error), activities: message.workspaceActivities }]
        : []
      void executeWorkspaceConversation(nextConversation, activeConversation.workspace, conversationProvider, retryAttempts)
      return
    }
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: activeAssistant,
      assistantMemories: enabledAssistantMemories,
      projectMemory: nextConversation.projectMemory,
      provider: conversationProvider,
      messages: nextConversation.messages,
      settings,
      reasoningEffort: nextConversation.reasoningEffort,
      ...getWebSearchRequestSettings(webSearchMode, nextConversation)
    })
  }

  function shouldPrepareLocalTask(text: string): boolean {
    return pendingAttachments.some((attachment) => attachment.localExecutable) &&
      /压缩|文件太大|附件太大|超出.{0,6}(限制|大小)|上传.{0,6}限制|不超过\s*\d+|最多\s*\d+|2097152|帮我弄一下|compress|too\s+large|size\s+limit|under\s+\d+|no\s+more\s+than\s+\d+/i.test(text)
  }

  function openWorkspaceArtifactMenu(event: ReactMouseEvent, rootPath: string, relativePath: string) {
    event.preventDefault()
    event.stopPropagation()
    setSelectionMenu(null)
    setImageAttachmentMenu(null)
    setWorkspaceArtifactMenu({
      x: Math.min(event.clientX, window.innerWidth - 230),
      y: Math.min(event.clientY, window.innerHeight - 70),
      rootPath,
      relativePath
    })
  }

  async function openWorkspaceArtifact(rootPath: string, relativePath: string) {
    try {
      await window.gllm.revealWorkspaceFile(rootPath, relativePath)
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('workspace.fileRevealFailed'))
    }
  }

  async function revealWorkspaceArtifact() {
    if (!workspaceArtifactMenu) return
    try {
      await openWorkspaceArtifact(workspaceArtifactMenu.rootPath, workspaceArtifactMenu.relativePath)
    } finally {
      setWorkspaceArtifactMenu(null)
    }
  }

  async function preparePendingLocalTask(text: string) {
    try {
      const plan = await window.gllm.prepareLocalFileTask(text, pendingAttachments.map((attachment) => attachment.id))
      setLocalTaskPlan(plan)
      setLocalTaskProgress(null)
      setLocalTaskResult(null)
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('localTask.prepareFailed'))
    }
  }

  async function executePendingLocalTask() {
    if (!localTaskPlan || localTaskRunning) return
    setLocalTaskRunning(true)
    setLocalTaskResult(null)
    try {
      const result = await window.gllm.executeLocalFileTask(localTaskPlan.id)
      setLocalTaskResult(result)
      const baseConversation =
        activeConversation?.assistantId === activeAssistant.id
          ? activeConversation
          : attachDraftWorkspace(
              createConversation(activeAssistant, assistantDefaultProvider, activeProjectId),
              draftWorkspace
            )
      const userMessage = createMessage('user', localTaskPlan.request, pendingAttachments)
      const successCount = result.artifacts.filter((artifact) => artifact.success).length
      const resultLines = result.artifacts.map((artifact) => {
        const sizeChange = artifact.outputSize === undefined
          ? formatAttachmentSize(artifact.originalSize)
          : `${formatAttachmentSize(artifact.originalSize)} → ${formatAttachmentSize(artifact.outputSize)}`
        return t('localTask.resultLine', {
          icon: artifact.success ? '✓' : '⚠',
          name: artifact.outputName ?? artifact.sourceName,
          size: sizeChange,
          message: artifact.message
        })
      })
      const assistantMessage = createMessage(
        'assistant',
        t('localTask.conversationSummary', {
          status: t(`localTask.status.${result.status}`),
          success: successCount,
          total: result.artifacts.length,
          results: resultLines.join('\n')
        })
      )
      const nextConversation = withConversationTokens({
        ...baseConversation,
        assistantId: activeAssistant.id,
        title: baseConversation.messages.length === 0 ? localTaskPlan.request.slice(0, 28) : baseConversation.title,
        messages: [...baseConversation.messages, userMessage, assistantMessage],
        updatedAt: Date.now()
      })
      selectConversation(nextConversation.id)
      setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
      void window.gllm.saveConversation(nextConversation)
      if (!activeConversation && draftWorkspace) setDraftWorkspace(undefined)
      setPendingAttachments([])
      setDraft('')
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('localTask.executeFailed'))
    } finally {
      setLocalTaskRunning(false)
    }
  }

  function closeLocalTask() {
    if (localTaskRunning) return
    setLocalTaskPlan(null)
    setLocalTaskProgress(null)
    setLocalTaskResult(null)
  }

  async function bindConversationWorkspace() {
    try {
      const rootPath = await window.gllm.chooseWorkspaceDirectory()
      if (!rootPath) return
      const normalizeWorkspacePath = (path: string) => {
        const normalized = path.replace(/[\\/]+$/, '').replace(/\\/g, '/')
        return window.gllm.platform === 'linux' ? normalized : normalized.toLocaleLowerCase()
      }
      const conflictingConversation = conversations.find((conversation) =>
        conversation.id !== activeConversation?.id &&
        conversation.workspace?.permission === 'read-write' &&
        normalizeWorkspacePath(conversation.workspace.rootPath) === normalizeWorkspacePath(rootPath)
      )
      if (conflictingConversation) {
        showToolNotice(
          t('workspace.folderConflict', { conversation: conflictingConversation.title }),
          0,
          { emphasis: true, requiresConfirmation: true, conversationId: conflictingConversation.id }
        )
        return
      }
      setPendingWorkspaceRoot(rootPath)
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('workspace.bindFailed'))
    }
  }

  async function confirmConversationWorkspace(approvalMode: NonNullable<ConversationWorkspace['approvalMode']>) {
    const rootPath = pendingWorkspaceRoot
    if (!rootPath) return
    setPendingWorkspaceRoot(null)
    try {
      const displayName = rootPath.split(/[\\/]/).filter(Boolean).at(-1) || t('workspace.defaultName')
      const workspace: ConversationWorkspace = {
        rootPath,
        displayName,
        permission: 'read-write',
        approvalMode,
        grantedAt: Date.now(),
        lastVerifiedAt: Date.now()
      }
      clearWorkspaceActivities()
      if (!activeConversation) {
        setDraftWorkspace(workspace)
        return
      }
      const nextConversation = { ...activeConversation, workspace, updatedAt: Date.now() }
      const saved = await window.gllm.saveConversation(nextConversation)
      setConversations((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('workspace.bindFailed'))
    }
  }

  async function changeConversationWorkspaceApproval(approvalMode: NonNullable<ConversationWorkspace['approvalMode']>) {
    if (!currentWorkspace) return
    const workspace = { ...currentWorkspace, approvalMode, lastVerifiedAt: Date.now() }
    if (!activeConversation) {
      setDraftWorkspace(workspace)
      return
    }
    const nextConversation = { ...activeConversation, workspace, updatedAt: Date.now() }
    const saved = await window.gllm.saveConversation(nextConversation)
    setConversations((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
  }

  async function unbindConversationWorkspace() {
    clearWorkspaceActivities()
    if (!activeConversation) {
      setDraftWorkspace(undefined)
      return
    }
    const nextConversation = { ...activeConversation, workspace: undefined, updatedAt: Date.now() }
    try {
      const saved = await window.gllm.saveConversation(nextConversation)
      setConversations((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
    } catch (error) {
      showToolNotice(error instanceof Error ? error.message : t('workspace.unbindFailed'))
    }
  }

  async function sendMessage(content = draft) {
    if (!settings || isConversationRunning(conversationRunStatesRef.current, activeConversation?.id)) return
    const candidateText = content.trim()
    if (shouldPrepareLocalTask(candidateText)) {
      await preparePendingLocalTask(candidateText)
      return
    }
    if (needsApiKey) {
      setSettingsOpen(true)
      return
    }

    const text = content.trim()
    const contextRefs = [...pendingQuoteRefs, ...pendingKnowledgeRefs]
    if (!text && pendingAttachments.length === 0 && contextRefs.length === 0) return
    const messageText =
      text ||
      (pendingQuoteRefs.length > 0
        ? t('notices.answerWithQuote')
        : pendingKnowledgeRefs.length > 0
          ? t('notices.answerWithKnowledge')
        : pendingAttachments.some((attachment) => attachment.kind === 'image')
          ? t('notices.analyzeImage')
          : t('notices.analyzeAttachment'))

    const baseConversation =
      activeConversation?.assistantId === activeAssistant.id
        ? activeConversation
        : createConversation(activeAssistant, assistantDefaultProvider, activeProjectId)
    const attachments = pendingAttachments
    const knowledgeRefs = contextRefs
    const userMessage = createMessage('user', messageText, attachments, knowledgeRefs)
    const nextConversation: Conversation = withConversationTokens({
      ...baseConversation,
      workspace: currentWorkspace,
      assistantId: activeAssistant.id,
      title: baseConversation.messages.length === 0 ? messageText.slice(0, 28) : baseConversation.title,
      messages: [...baseConversation.messages, userMessage],
      updatedAt: Date.now()
    })

    if (!activeConversation) moveComposerSessionToConversation(nextConversation.id, true)
    setDraft('')
    setPendingAttachments([])
    setPendingQuoteRefs([])
    setPendingKnowledgeRefs([])
    beginConversationRun(nextConversation.id)
    if (newConversationDraftRef.current?.id === nextConversation.id) newConversationDraftRef.current = null
    selectConversation(nextConversation.id)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    void window.gllm.saveConversation(nextConversation)
    if (currentWorkspace) {
      if (!activeConversation) setDraftWorkspace(undefined)
      await executeWorkspaceConversation(
        nextConversation,
        currentWorkspace,
        activeConversation?.assistantId === activeAssistant.id ? conversationProvider : assistantDefaultProvider
      )
      return
    }
    streamingConversationDraftsRef.current[nextConversation.id] = nextConversation
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant: activeAssistant,
      assistantMemories: enabledAssistantMemories,
      projectMemory: nextConversation.projectMemory,
      provider: activeConversation?.assistantId === activeAssistant.id ? conversationProvider : assistantDefaultProvider,
      messages: nextConversation.messages,
      settings,
      reasoningEffort: nextConversation.reasoningEffort,
      ...getWebSearchRequestSettings(webSearchMode, nextConversation)
    })
  }

  function stopGenerating() {
    if (!isStreaming || !activeConversation) return
    window.gllm.cancelResponse(activeConversation.id)
    const stoppedConversation = stopConversationWebSearch(activeConversation)
    if (stoppedConversation !== activeConversation) {
      streamingConversationDraftsRef.current[activeConversation.id] = stoppedConversation
      setConversations((current) => current.map((conversation) =>
        conversation.id === stoppedConversation.id ? stoppedConversation : conversation
      ))
      void window.gllm.saveConversation(stoppedConversation)
    }
    discardConversationRun(activeConversation.id)
  }

  async function saveSettings(next: AppSettings) {
    const saved = await window.gllm.saveSettings(next)
    setSettings(saved)
    return saved
  }

  async function acceptUserAgreement() {
    if (!settings) return

    const saved = await saveSettings({
      ...settings,
      setupCompleted: true
    })
    setAgreementOpen(false)

    const provider = getProviderById(saved.activeProviderId, providers)
    if (provider.requiresApiKey && !provider.apiKey.trim()) {
      setSettingsOpen(true)
    }
  }

  async function recoverExistingDataDirectory() {
    try {
      const result = await window.gllm.chooseExistingDataDirectory()
      if (!result) return

      setDataLocation(result.info)
      const shouldRestart = window.confirm(t('storage.confirmRecoverRestart', { message: result.message }))
      if (shouldRestart) {
        await window.gllm.relaunchApp()
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveProvider(next: ApiProvider) {
    const saved = await window.gllm.saveProvider(next)
    const nextProviders = [saved, ...providers.filter((provider) => provider.id !== saved.id)]
    setProviders(nextProviders)
    return saved
  }

  async function checkProvider(next: ApiProvider): Promise<ProviderCheckResult> {
    return window.gllm.checkProvider(next)
  }

  async function refreshProviderModels(next: ApiProvider) {
    const saved = await window.gllm.refreshProviderModels(next)
    const nextProviders = [saved, ...providers.filter((provider) => provider.id !== saved.id)]
    setProviders(nextProviders)
    return saved
  }

  async function deleteProvider(id: string) {
    await window.gllm.deleteProvider(id)
    const nextProviders = providers.filter((provider) => provider.id !== id)
    setProviders(nextProviders)
    setSettings((current) => (current?.activeProviderId === id ? { ...current, activeProviderId: DEFAULT_PROVIDER_ID } : current))
  }

  async function saveAssistant(next: Assistant) {
    const saved = await window.gllm.saveAssistant({ ...next, projectId: next.projectId ?? activeProjectId })
    setAssistants((current) => {
      if (current.some((assistant) => assistant.id === saved.id)) {
        return current.map((assistant) => (assistant.id === saved.id ? saved : assistant))
      }

      const builtIns = current.filter((assistant) => assistant.builtIn)
      const custom = current.filter((assistant) => !assistant.builtIn)
      return [...builtIns, saved, ...custom]
    })
    setActiveAssistantId(saved.id)
    return saved
  }

  async function toggleAssistantPin(assistant: Assistant) {
    setAssistantContextMenu(null)
    const saved = await window.gllm.saveAssistant({
      ...assistant,
      pinnedAt: assistant.pinnedAt ? undefined : Date.now()
    })
    setAssistants((current) => current.map((item) => (item.id === saved.id ? saved : item)))
  }

  async function suggestAssistant(keyword: string, provider: ApiProvider): Promise<AssistantSuggestion> {
    if (!settings) throw new Error(t('notices.settingsNotLoaded'))
    return window.gllm.suggestAssistant({
      keyword,
      provider,
      settings
    })
  }

  if (!settings) {
    return (
      <div className={`boot ${isMac ? 'mac-window' : ''}`}>
        <img src={logo} alt="G-LLM" />
      </div>
    )
  }

  return (
    <div
      className={`app-shell ${isMac ? 'mac-window' : ''} ${isWindows ? 'windows-framed' : ''} ${railCollapsed ? 'rail-collapsed' : ''} ${historyCollapsed ? 'history-collapsed' : ''}`}
    >
      {isWindows && (
        <div className="windows-titlebar">
          <img src={logo} alt="" />
          <span>{t('about.productName')}</span>
        </div>
      )}
      {!railCollapsed && (
        <aside className="rail">
          <div className="brand">
            <button className="brand-space-button" onClick={() => setSpaceCenterOpen(true)} title={t('app.openSpaceCenter')} type="button">
              <SpaceLogo project={activeSpace} />
              <span>
                <strong>{activeSpaceName}</strong>
                <small>{activeSpaceSubtitle}</small>
              </span>
            </button>
            <button className="icon-button compact" onClick={() => setRailCollapsed(true)} title={t('app.collapseAssistantRail')} type="button">
              <PanelLeftClose size={16} />
            </button>
          </div>

          <label className="assistant-search" title={t('app.searchTitle')}>
            <Search size={15} />
            <input
              value={assistantSearchQuery}
              placeholder={t('app.searchPlaceholder')}
              onChange={(event) => setAssistantSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                void runConversationSearch(assistantSearchQuery)
              }}
            />
            {assistantSearchQuery && (
              <button onClick={() => setAssistantSearchQuery('')} title={t('app.clearSearch')} type="button">
                <X size={14} />
              </button>
            )}
            <button
              className="assistant-smart-search-button"
              onClick={() => void runConversationSearch(assistantSearchQuery)}
              title={assistantSearchQuery.trim() ? t('app.smartSearchHistory') : t('app.recentConversations')}
              type="button"
            >
              <Sparkles size={14} />
            </button>
          </label>

          <div className="assistant-list">
            {filteredAssistants.map((assistant) => {
              const active = assistant.id === activeAssistantId
              const displayAssistant = localizeAssistant(assistant)
              const assistantRunStatuses = conversations
                .filter((conversation) => conversation.assistantId === assistant.id)
                .map((conversation) => conversationRunStates[conversation.id]?.status)
                .filter(Boolean)
              const assistantRunStatus = assistantRunStatuses.includes('running')
                ? 'running'
                : assistantRunStatuses.includes('error')
                  ? 'error'
                  : assistantRunStatuses.includes('completed')
                    ? 'completed'
                    : undefined
              const assistantRunLabel = assistantRunStatus
                ? t(`conversationActions.${assistantRunStatus === 'running' ? 'responding' : assistantRunStatus === 'completed' ? 'responseReady' : 'responseFailed'}`)
                : ''
              return (
                <button
                  key={assistant.id}
                  className={`assistant-card ${assistant.color} ${active ? 'active' : ''} ${assistant.pinnedAt ? 'pinned' : ''} ${assistantRunStatus ?? ''}`}
                  onClick={() => openAssistant(assistant)}
                  onContextMenu={(event) => openAssistantContextMenu(event, assistant)}
                  title={displayAssistant.name}
                  type="button"
                >
                  <AssistantAvatar assistant={assistant} />
                  <span className="assistant-card-copy">
                    <span className="assistant-card-heading">
                      <strong>{displayAssistant.name}</strong>
                      {assistant.pinnedAt && <Pin className="assistant-pin-badge" size={12} aria-label={t('assistantActions.pinned')} />}
                      {assistantRunStatus === 'running' && (
                        <span className="assistant-run-badge running" title={assistantRunLabel} aria-label={assistantRunLabel}>
                          <span className="mini-spinner" aria-hidden="true" />
                        </span>
                      )}
                      {assistantRunStatus === 'completed' && (
                        <CircleCheck className="assistant-run-badge completed" size={12} aria-label={assistantRunLabel} />
                      )}
                      {assistantRunStatus === 'error' && (
                        <CircleAlert className="assistant-run-badge error" size={12} aria-label={assistantRunLabel} />
                      )}
                    </span>
                    <small>{displayAssistant.title}</small>
                  </span>
                </button>
              )
            })}
            {filteredAssistants.length === 0 && (
              <div className="assistant-empty">
                <Search size={18} />
                <span>{t('app.noAssistants')}</span>
              </div>
            )}
          </div>

          <div className="rail-actions">
            <button className="icon-button" onClick={() => setAssistantCenterOpen(true)} title={t('app.addAssistant')}>
              <Plus size={18} />
            </button>
            {hiddenAssistants.length > 0 && (
              <button
                className="icon-button rail-hidden-assistants"
                onClick={() => setHiddenAssistantsOpen(true)}
                title={t('assistantActions.manageHidden', { count: hiddenAssistants.length })}
                type="button"
              >
                <EyeOff size={18} />
                <span>{hiddenAssistants.length}</span>
              </button>
            )}
            <button className="icon-button" onClick={() => setSettingsOpen(true)} title={t('app.providerSettings')}>
              <Settings size={18} />
            </button>
          </div>
        </aside>
      )}

      {assistantContextMenu && (() => {
        const assistant = assistants.find((item) => item.id === assistantContextMenu.assistantId)
        if (!assistant) return null
        return (
          <div
            className="selection-context-menu assistant-context-menu"
            style={{ left: assistantContextMenu.x, top: assistantContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              onClick={() => void toggleAssistantPin(assistant)}
            >
              {assistant.pinnedAt ? <PinOff size={15} /> : <Pin size={15} />}
              {t(assistant.pinnedAt ? 'assistantActions.unpin' : 'assistantActions.pin')}
            </button>
            <button type="button" onClick={() => void setAssistantHidden(assistant, true)}>
              <EyeOff size={15} />
              {t('assistantActions.hide')}
            </button>
            <button className="danger" type="button" onClick={() => void deleteAssistantWithConfirmation(assistant)}>
              <Trash2 size={15} />
              {t('assistantActions.delete')}
            </button>
          </div>
        )
      })()}

      {conversationContextMenu && (() => {
        const conversation = conversations.find((item) => item.id === conversationContextMenu.conversationId)
        if (!conversation) return null
        return (
          <div
            className="selection-context-menu conversation-context-menu"
            style={{ left: conversationContextMenu.x, top: conversationContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button type="button" onClick={() => void toggleConversationPin(conversation)}>
              {conversation.pinnedAt ? <PinOff size={15} /> : <Pin size={15} />}
              {t(conversation.pinnedAt ? 'conversationActions.unpin' : 'conversationActions.pin')}
            </button>
            <button className="danger" type="button" onClick={() => void removeConversation(conversation.id)}>
              <Trash2 size={15} />
              {t('conversationActions.delete')}
            </button>
          </div>
        )
      })()}

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            {railCollapsed && (
              <button className="icon-button compact" onClick={() => setRailCollapsed(false)} title={t('app.expandAssistantRail')} type="button">
                <PanelLeftOpen size={16} />
              </button>
            )}
            <div className="topbar-title">
              <div className="topbar-heading">
                <h1 title={activeAssistantDisplay.name}>{activeAssistantDisplay.name}</h1>
                <span className="topbar-assistant-description" title={activeAssistantDisplay.title}>
                  {activeAssistantDisplay.title}
                </span>
              </div>
              <div className="topbar-session-row">
                <span className="topbar-conversation-title" title={topbarConversationTitle}>
                  {topbarConversationTitle}
                </span>
                <span className="topbar-token-summary" title={activeConversationTokenDetail}>
                  {activeConversationTokenSummary}
                </span>
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            {activeConversation?.projectMemory && (
              <button
                className="icon-button compact project-memory-button"
                onClick={() => showToolNotice(t('workspace.projectMemoryNotice', { summary: projectMemorySummary.slice(0, 700) }), 9000)}
                title={`${t('app.projectMemory')}\n${projectMemorySummary}`}
                type="button"
              >
                <Brain size={16} />
              </button>
            )}
            <button className="icon-button compact" onClick={() => setAssistantSettingsOpen(true)} title={t('app.assistantSettings')} type="button">
              <Pencil size={16} />
            </button>
            <button className="icon-button compact" disabled={isStreaming} onClick={openConversationModelSettings} title={t('app.conversationModel')}>
              <SlidersHorizontal size={16} />
            </button>
            {historyCollapsed && (
              <button className="icon-button compact" onClick={() => setHistoryCollapsed(false)} title={t('app.expandConversationRail')} type="button">
                <PanelRightOpen size={16} />
              </button>
            )}
          </div>
        </header>

        <section className="chat-panel">
          <div className="messages" ref={listRef} onScroll={updateMessageScrollState} onWheel={handleMessageWheel}>
            {needsApiKey && (
              <div className="setup-banner">
                <KeyRound size={18} />
                <span>{t('app.apiKeyRequired', { provider: conversationProvider.name })}</span>
                <button onClick={() => setSettingsOpen(true)}>{t('app.configure')}</button>
              </div>
            )}
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <div className="starter-grid">
                {activeAssistantDisplay.starterPrompts.map((prompt) => (
                  <button key={prompt} onClick={() => sendMessage(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            ) : (
              <>
              {activeConversation.messages.map((message, messageIndex) => {
                const isTranslating = translatingMessageIds.includes(message.id)
                const isEditing = editingMessageId === message.id
                const isReasoningInProgress = Boolean(
                  message.reasoningContent &&
                  isStreaming &&
                  messageIndex === activeConversation.messages.length - 1 &&
                  message.role === 'assistant'
                )
                const messageTokens = estimateMessageTokenUsage(message)
                const messageTimestamp = formatMessageTimestamp(
                  message.createdAt,
                  i18n.resolvedLanguage ?? 'zh-CN',
                  settings.timeZone
                )

                return (
                  <article
                    key={message.id}
                    className={`message ${message.role} ${message.error ? 'message-error' : ''}`}
                    data-message-id={message.id}
                    onContextMenu={(event) => openSelectionContextMenu(event, message)}
                  >
                    <div className="message-stack">
                      <div className="message-bubble">
                        {message.webSearch && <WebSearchActivityCard activity={message.webSearch} />}
                        {((message.workspaceActivities?.length ?? 0) > 0 || (message.workspaceChangedFiles?.length ?? 0) > 0) && (
                          <WorkspaceActivityLog
                            activities={message.workspaceActivities ?? []}
                            changedFiles={message.workspaceChangedFiles}
                            artifactRoot={message.workspaceArtifactRoot}
                            onArtifactOpen={(rootPath, relativePath) => void openWorkspaceArtifact(rootPath, relativePath)}
                            onArtifactContextMenu={openWorkspaceArtifactMenu}
                          />
                        )}
                        {message.reasoningContent && (
                          isReasoningInProgress ? (
                            <div className="message-reasoning running">
                              <div className="message-reasoning-label">
                                <Brain size={15} />
                                <span>{t('app.reasoningInProgress')}</span>
                                <span className="typing-dots compact" aria-hidden="true"><i /><i /><i /></span>
                              </div>
                              <div className="message-reasoning-content markdown-body">
                                <MarkdownMessage content={message.reasoningContent} />
                              </div>
                            </div>
                          ) : (
                            <details className="message-reasoning">
                              <summary>
                                <Brain size={15} />
                                <span>{t('app.reasoningProcess')}</span>
                              </summary>
                              <div className="message-reasoning-content markdown-body">
                                <MarkdownMessage content={message.reasoningContent} />
                              </div>
                            </details>
                          )
                        )}
                        {isEditing ? (
                          <div className="message-edit-panel">
                            <textarea
                              autoFocus
                              aria-label={t('app.editMessage')}
                              value={editingMessageContent}
                              onChange={(event) => setEditingMessageContent(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                  event.preventDefault()
                                  cancelMessageEdit()
                                } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                  event.preventDefault()
                                  resendEditedMessage(message.id)
                                }
                              }}
                            />
                            <small>{t('app.editMessageBranchHint')}</small>
                            <div className="message-edit-actions">
                              <button type="button" onClick={cancelMessageEdit}>{t('common.cancel')}</button>
                              <button
                                className="primary"
                                disabled={!editingMessageContent.trim()}
                                type="button"
                                onClick={() => resendEditedMessage(message.id)}
                              >
                                <Send size={14} />
                                {t('app.resendEditedMessage')}
                              </button>
                            </div>
                          </div>
                        ) : (message.content.trim() || !message.webSearch) && (
                          <div className="message-content markdown-body">
                            <MarkdownMessage content={message.content} />
                          </div>
                        )}
                        {message.error && (
                          <ChatErrorRetry
                            error={message.error}
                            retryAt={messageIndex === activeConversation.messages.length - 1 && !message.workspaceArtifactRoot ? message.retryAt : undefined}
                            disabled={isStreaming}
                            onRetry={() => regenerateMessage(message.id)}
                          />
                        )}
                        {(message.retryAttempts?.length ?? 0) > 0 && (
                          <details className="message-retry-history">
                            <summary>{t('app.attemptHistory', { count: message.retryAttempts!.length })}</summary>
                            <ol>
                              {message.retryAttempts!.map((attempt, index) => (
                                <li key={`${attempt.attemptedAt}_${index}`}>
                                  <time>{new Date(attempt.attemptedAt).toLocaleString()}</time>
                                  <span>{formatWorkspaceError(attempt.error)}</span>
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                        {message.attachments && message.attachments.length > 0 && (
                          <div className="message-attachments">
                            {message.attachments.map((attachment) => (
                              <span
                                key={attachment.id}
                                className={`attachment-chip ${attachment.kind === 'image' && attachment.dataUrl ? 'image-chip' : ''}`}
                                title={`${attachment.name} · ${formatAttachmentSize(attachment.size)}`}
                                onContextMenu={(event) => openImageAttachmentMenu(event, attachment)}
                              >
                                {attachment.kind === 'image' && attachment.dataUrl ? (
                                  <button
                                    aria-label={t('app.imagePreview')}
                                    className="attachment-image-preview"
                                    onClick={() => setImagePreview({ dataUrl: attachment.dataUrl!, name: attachment.name })}
                                    type="button"
                                  >
                                    <img alt={attachment.name} src={attachment.dataUrl} />
                                  </button>
                                ) : attachment.kind === 'image' ? (
                                  <ImagePlus size={14} />
                                ) : (
                                  <Paperclip size={14} />
                                )}
                                <span>{attachment.name}</span>
                              </span>
                            ))}
                          </div>
                        )}
                        {message.knowledgeRefs && message.knowledgeRefs.length > 0 && (
                          <div className="message-attachments">
                            {message.knowledgeRefs.map((reference) => {
                              const isQuote = isQuoteReference(reference)
                              return (
                                <span
                                  key={reference.id}
                                  className={`attachment-chip ${isQuote ? 'quote-chip' : 'knowledge-chip'}`}
                                  title={reference.content}
                                >
                                  {isQuote ? <AtSign size={14} /> : <BookOpen size={14} />}
                                  {reference.title}
                                </span>
                              )
                            })}
                          </div>
                        )}
                        {!isEditing && (message.translation !== undefined || isTranslating) && (
                          <div className="translation-block">
                            <div className="translation-divider">
                              <span />
                              <Languages size={16} />
                              <span />
                            </div>
                            <div className={`message-translation markdown-body ${!message.translation ? 'pending' : ''}`}>
                              {message.translation ? <MarkdownMessage content={message.translation} /> : t('app.translating')}
                            </div>
                          </div>
                        )}
                      </div>
                      {!isEditing && <div className="message-footer">
                        <div className="message-actions" onMouseDown={(event) => event.preventDefault()}>
                          <button title={t('app.copyMarkdown')} type="button" onClick={() => void copyMessage(message.content)}>
                            <Copy size={16} />
                          </button>
                          {message.role === 'user' && (
                            <button
                              disabled={isStreaming}
                              title={t('app.editAndResend')}
                              type="button"
                              onClick={() => editMessage(message)}
                            >
                              <Pencil size={16} />
                            </button>
                          )}
                          {message.role === 'assistant' && !message.error && (
                            <button
                              disabled={isStreaming}
                              title={t('app.regenerate')}
                              type="button"
                              onClick={() => regenerateMessage(message.id)}
                            >
                              <RefreshCw size={16} />
                            </button>
                          )}
                          <button title={t('app.quoteMessage')} type="button" onClick={() => quoteMessage(message)}>
                            <AtSign size={16} />
                          </button>
                          <button
                            disabled={isStreaming || isTranslating}
                            title={isTranslating ? t('app.translating') : t('app.translate')}
                            type="button"
                            onClick={() => translateMessage(message)}
                          >
                            <Languages size={16} />
                          </button>
                          <button title={t('app.saveToKnowledge')} type="button" onClick={() => void saveMessageToNote(message)}>
                            <NotebookPen size={16} />
                          </button>
                          <button title={t('common.delete')} type="button" onClick={() => deleteMessage(message.id)}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                        <div className="message-meta">
                          <time dateTime={messageTimestamp.iso} title={messageTimestamp.full}>{messageTimestamp.short}</time>
                          <span
                            className="message-token"
                            title={t('app.tokenBreakdown', {
                              total: formatTokenUnit(messageTokens.total),
                              input: formatTokenUnit(messageTokens.input),
                              output: formatTokenUnit(messageTokens.output)
                            })}
                          >
                            {t('app.tokenCount', { count: formatTokenUnit(messageTokens.total) })}
                            <span>↑{formatTokenUnit(messageTokens.input)}</span>
                            <span>↓{formatTokenUnit(messageTokens.output)}</span>
                          </span>
                          {message.contextSavings && (
                            <span
                              className="message-context-saving"
                              title={t('app.contextSavingsDetail', {
                                original: formatTokenUnit(message.contextSavings.originalCharacters),
                                sent: formatTokenUnit(message.contextSavings.sentCharacters),
                                items: message.contextSavings.compactedItems
                              })}
                            >
                              {t('app.contextSavings', { percent: message.contextSavings.savedPercent })}
                            </span>
                          )}
                        </div>
                      </div>}
                    </div>
                  </article>
                )
              })
              }
              {waitingForAssistantResponse && (
                <article className="message assistant pending-response" aria-live="polite">
                  <div className="message-stack">
                    <div className="message-bubble pending-response-bubble">
                      {currentWorkspace ? (
                        <WorkspaceActivityLog
                          activities={workspaceActivities}
                          model={conversationProvider.defaultModel}
                          running
                          startedAt={activeRunStartedAt}
                        />
                      ) : (
                        <ModelResponseWait model={conversationProvider.defaultModel} startedAt={activeRunStartedAt} />
                      )}
                    </div>
                  </div>
                </article>
              )}
              </>
            )}
          </div>
          {selectionMenu && (
            <div
              className="selection-context-menu"
              style={{ left: selectionMenu.x, top: selectionMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button type="button" onClick={() => void copySelectionMenuText()}>
                <Copy size={15} />
                {t('common.copy')}
              </button>
              <button type="button" onClick={quoteSelectionMenuText}>
                <AtSign size={15} />
                {t('common.quote')}
              </button>
            </div>
          )}
          {imageAttachmentMenu && (
            <div
              className="selection-context-menu"
              style={{ left: imageAttachmentMenu.x, top: imageAttachmentMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button type="button" onClick={() => void copyImageAttachmentToClipboard()}>
                <Copy size={15} />
                {t('app.copyImage')}
              </button>
            </div>
          )}
          {imagePreview && <ImagePreviewDialog image={imagePreview} onClose={() => setImagePreview(null)} />}
          {workspaceArtifactMenu && (
            <div
              className="selection-context-menu workspace-artifact-context-menu"
              style={{ left: workspaceArtifactMenu.x, top: workspaceArtifactMenu.y }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.preventDefault()}
            >
              <button type="button" onClick={() => void revealWorkspaceArtifact()}>
                <FolderOpen size={15} />
                {isMac ? t('app.revealFinder') : t('app.revealExplorer')}
              </button>
            </div>
          )}
          {showScrollToLatest && (
            <button
              className="scroll-latest-button"
              style={{ bottom: `${Math.max(104, composerHeight + 18)}px` }}
              type="button"
              onClick={() => scrollToLatest('smooth')}
            >
              {isStreaming ? `${t('app.aiResponding')} · ↓` : `↓ ${t('app.scrollLatest')}`}
            </button>
          )}

          <form
            className="composer"
            ref={composerRef}
            onSubmit={(event) => {
              event.preventDefault()
              sendMessage()
            }}
          >
            {currentWorkspace && (
              <WorkspaceBar
                workspace={currentWorkspace}
                onApprovalModeChange={(mode) => void changeConversationWorkspaceApproval(mode)}
                onUnbind={() => void unbindConversationWorkspace()}
              />
            )}
            {toolNotice && (
              <div
                className={`composer-notice ${toolNotice.emphasis ? 'emphasis' : ''}`}
                role={toolNotice.emphasis ? 'alert' : 'status'}
              >
                <span>{toolNotice.message}</span>
                {(toolNotice.conversationId || toolNotice.settingsTab || toolNotice.requiresConfirmation) && (
                  <div className="composer-notice-actions">
                    {toolNotice.conversationId && (
                      <button type="button" onClick={() => openToolNoticeConversation(toolNotice.conversationId!)}>
                        {t('app.goToConversation')}
                      </button>
                    )}
                    {toolNotice.settingsTab && (
                      <button type="button" onClick={() => openToolNoticeSettings(toolNotice.settingsTab!)}>
                        {toolNotice.settingsTab === 'about' ? t('about.viewUpdate') : t('app.settings')}
                      </button>
                    )}
                    {toolNotice.requiresConfirmation && (
                      <button className="secondary" type="button" onClick={dismissToolNotice}>{t('app.confirm')}</button>
                    )}
                  </div>
                )}
              </div>
            )}
            {pendingQuoteRefs.length > 0 && (
              <div className="composer-quote-cards">
                {pendingQuoteRefs.map((reference) => (
                  <div key={reference.id} className="composer-quote-card">
                    <div className="composer-quote-card-header">
                      <span className="composer-quote-card-title">
                        <AtSign size={14} />
                        <span>{reference.title}</span>
                      </span>
                      <button onClick={() => removePendingQuoteRef(reference.id)} title={t('app.removeQuote')} type="button">
                        <X size={13} />
                      </button>
                    </div>
                    <p>{reference.content}</p>
                  </div>
                ))}
              </div>
            )}
            {pendingAttachments.length > 0 && (
              <div className="composer-attachments">
                {pendingAttachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className={`attachment-chip ${attachment.kind === 'image' && attachment.dataUrl ? 'image-chip' : ''} ${attachment.kind === 'image' && !attachment.dataUrl ? 'warning' : ''} ${attachment.localExecutable ? 'local-executable' : ''}`}
                    title={`${attachment.name} · ${formatAttachmentSize(attachment.size)} · ${attachment.localExecutable
                      ? t('attachments.localExecutable')
                      : attachment.kind === 'image'
                        ? !attachment.dataUrl
                          ? t('attachments.imageUnreadable')
                          : modelCapabilities.imageInput
                            ? t('attachments.imageSupported')
                            : t('attachments.imageVisualInput')
                        : attachment.text
                          ? t('attachments.textExtracted')
                          : t('attachments.textUnavailable')}`}
                    onContextMenu={(event) => openImageAttachmentMenu(event, attachment)}
                  >
                    {attachment.kind === 'image' && attachment.dataUrl ? (
                      <button
                        aria-label={t('app.imagePreview')}
                        className="attachment-image-preview"
                        onClick={() => setImagePreview({ dataUrl: attachment.dataUrl!, name: attachment.name })}
                        type="button"
                      >
                        <img alt={attachment.name} src={attachment.dataUrl} />
                      </button>
                    ) : attachment.kind === 'image' ? (
                      <ImagePlus size={14} />
                    ) : (
                      <Paperclip size={14} />
                    )}
                    <span>{attachment.name}</span>
                    <button onClick={() => removePendingAttachment(attachment.id)} title={t('common.remove')} type="button">
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {pendingKnowledgeRefs.length > 0 && (
              <div className="composer-attachments">
                {pendingKnowledgeRefs.map((reference) => (
                  <span key={reference.id} className="attachment-chip knowledge-chip" title={reference.content}>
                    <BookOpen size={14} />
                    <span>{reference.title}</span>
                    <button onClick={() => removePendingKnowledgeRef(reference.id)} title={t('app.removeQuote')} type="button">
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="composer-input-row">
              <textarea
                ref={composerTextareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onPaste={(event) => void handleComposerPaste(event)}
                onKeyDown={(event) => {
                  if (shouldSendMessageFromKeyboard(event, messageSendShortcut)) {
                    event.preventDefault()
                    sendMessage()
                  }
                }}
                placeholder={needsApiKey ? t('app.configureApiKey') : t('app.messageAssistant', { assistant: activeAssistantDisplay.name })}
                rows={1}
              />
            </div>
            <div className="composer-toolbar">
              <div className="composer-tools">
                <button
                  className={pendingAttachments.some((attachment) => attachment.kind === 'file') ? 'active' : ''}
                  disabled={isPickingAttachment}
                  title={t('app.uploadAttachmentDetailed')}
                  type="button"
                  onClick={() => void pickComposerAttachments('file')}
                >
                  <Paperclip size={16} />
                </button>
                <button
                  className={pendingAttachments.some((attachment) => attachment.kind === 'image') ? 'active' : ''}
                  disabled={isPickingAttachment}
                  title={t('app.captureScreenshot')}
                  type="button"
                  onClick={() => void captureComposerScreenshot()}
                >
                  <ImagePlus size={16} />
                </button>
                <button
                  className={currentWorkspace ? 'active' : ''}
                  title={t('app.workspaceFolder')}
                  type="button"
                  onClick={() => void bindConversationWorkspace()}
                >
                  <FolderOpen size={16} />
                </button>
                <button
                  className={knowledgeOpen || pendingKnowledgeRefs.length > 0 ? 'active' : ''}
                  title={t('app.knowledgeBase')}
                  type="button"
                  onClick={() => setKnowledgeOpen(true)}
                >
                  <BookOpen size={16} />
                </button>
                <WebSearchModePicker
                  disabled={isStreaming}
                  mode={webSearchMode}
                  onChange={changeActiveConversationWebSearchMode}
                />
                <button
                  className={toolCenterOpen || tools.some((tool) => tool.enabled) ? 'active' : ''}
                  title={t('app.extensions')}
                  type="button"
                  onClick={() => setToolCenterOpen(true)}
                >
                  <Wrench size={16} />
                </button>
              </div>
              <div className="composer-input-actions">
                <ModelPickerMenu
                  className="composer-model-picker"
                  compactTrigger
                  provider={conversationProvider}
                  value={conversationProvider.defaultModel}
                  variant="dropdown"
                  placement="top"
                  showTriggerCapabilities={false}
                  disabled={isStreaming}
                  reasoningEffort={activeReasoningEffort}
                  onReasoningEffortChange={changeActiveConversationReasoningEffort}
                  onModelReasoningChange={changeActiveConversationModelAndReasoning}
                  onChange={changeActiveConversationModel}
                />
                <button
                  className={`send-button${isStreaming ? ' stop' : ''}`}
                  disabled={
                    !isStreaming &&
                    !draft.trim() &&
                    pendingAttachments.length === 0 &&
                    pendingQuoteRefs.length === 0 &&
                    pendingKnowledgeRefs.length === 0
                  }
                  onClick={isStreaming ? stopGenerating : undefined}
                  title={isStreaming ? t('app.stopGenerating') : t('app.send', { shortcut: messageSendShortcutLabel })}
                  type={isStreaming ? 'button' : 'submit'}
                >
                  {isStreaming ? <Square size={15} fill="currentColor" /> : <Send size={18} />}
                </button>
              </div>
            </div>
          </form>
        </section>
      </main>

      {!historyCollapsed && (
        <aside className="history">
          <div className="history-title">
            <div>
              <PanelRightOpen size={17} />
              <span>{t('app.currentAssistantConversations')}</span>
            </div>
            <div className="history-title-actions">
              <button className="icon-button compact" onClick={startNewChat} title={t('app.newConversation')}>
                <MessageSquarePlus size={16} />
              </button>
              <button className="icon-button compact" onClick={() => setHistoryCollapsed(true)} title={t('app.collapseConversationRail')} type="button">
                <PanelRightClose size={16} />
              </button>
            </div>
          </div>
          <div className="history-list">
            {activeAssistantConversations.length === 0 && <div className="history-empty">{t('app.noConversations')}</div>}
            {activeAssistantConversations.map((conversation) => {
              const runState = conversationRunStates[conversation.id]
              const runStatusLabel = runState
                ? t(`conversationActions.${runState.status === 'running' ? 'responding' : runState.status === 'completed' ? 'responseReady' : 'responseFailed'}`)
                : ''
              return (
              <div
                key={conversation.id}
                className={`history-item ${conversation.id === activeConversationId ? 'active' : ''} ${conversation.pinnedAt ? 'pinned' : ''} ${runState?.status ?? ''}`}
                onClick={() => {
                  selectConversation(conversation.id)
                }}
                onContextMenu={(event) => openConversationContextMenu(event, conversation)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  selectConversation(conversation.id)
                }}
                role="button"
                tabIndex={0}
              >
                <span className="history-item-main">
                  <span className="history-item-title">
                    <span>{conversation.title}</span>
                    {conversation.workspace && (
                      <FolderOpen
                        className="history-workspace-badge"
                        size={13}
                        aria-label={t('app.workspaceAuthorized')}
                      />
                    )}
                    {runState?.status === 'running' && (
                      <span className="history-run-badge running" title={runStatusLabel} aria-label={runStatusLabel}>
                        <span className="mini-spinner" aria-hidden="true" />
                      </span>
                    )}
                    {runState?.status === 'completed' && (
                      <CircleCheck className="history-run-badge completed" size={13} aria-label={runStatusLabel} />
                    )}
                    {runState?.status === 'error' && (
                      <CircleAlert className="history-run-badge error" size={13} aria-label={runStatusLabel} />
                    )}
                  </span>
                  <small>
                    <time>{formatSidebarConversationTime(conversation.updatedAt, i18n.resolvedLanguage ?? 'zh-CN')}</time>
                    {conversation.pinnedAt && <span>{t('conversationActions.pinned')}</span>}
                    {runState && <span className={`history-run-label ${runState.status}`}>{runStatusLabel}</span>}
                  </small>
                </span>
                <span className="history-item-actions">
                  <button
                    className={conversation.pinnedAt ? 'active' : ''}
                    onClick={(event) => {
                      event.stopPropagation()
                      void toggleConversationPin(conversation)
                    }}
                    title={t(conversation.pinnedAt ? 'conversationActions.unpin' : 'conversationActions.pin')}
                    type="button"
                  >
                    <Pin size={14} fill={conversation.pinnedAt ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      void removeConversation(conversation.id)
                    }}
                    title={t('conversationActions.delete')}
                    type="button"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
              )
            })}
          </div>
        </aside>
      )}

      {hiddenAssistantsOpen && (
        <HiddenAssistantsDialog
          assistants={hiddenAssistants}
          onClose={() => setHiddenAssistantsOpen(false)}
          onDelete={deleteAssistantWithConfirmation}
          onRestore={(assistant) => setAssistantHidden(assistant, false)}
        />
      )}
      {assistantCenterOpen && (
        <AddAssistantDialog
          globalProviderId={settings.activeProviderId}
          providers={providers}
          onClose={() => setAssistantCenterOpen(false)}
          onSave={saveAssistant}
          onSuggest={suggestAssistant}
        />
      )}
      {pendingWorkspaceRoot && (
        <WorkspaceApprovalDialog
          rootPath={pendingWorkspaceRoot}
          onCancel={() => setPendingWorkspaceRoot(null)}
          onSelect={(mode) => void confirmConversationWorkspace(mode)}
        />
      )}
      {workspaceApprovalPrompt && (
        <WorkspaceOperationApprovalDialog
          prompt={workspaceApprovalPrompt}
          onRespond={(approved) => {
            window.gllm.respondWorkspaceApproval(workspaceApprovalPrompt.id, approved)
            setWorkspaceApprovalPrompts((current) => current.filter((prompt) => prompt.id !== workspaceApprovalPrompt.id))
          }}
        />
      )}
      {assistantSettingsOpen && (
        <AssistantSettingsDialog
          assistant={activeAssistant}
          onClose={() => setAssistantSettingsOpen(false)}
          onSave={saveAssistant}
        />
      )}
      {conversationModelOpen && activeConversation && (
        <ConversationModelDialog
          conversation={activeConversation}
          assistant={activeAssistant}
          globalProviderId={settings.activeProviderId}
          providers={providers}
          onClose={() => setConversationModelOpen(false)}
          onSaveAssistant={saveAssistant}
          onSaveConversation={saveConversationUpdate}
        />
      )}
      {knowledgeOpen && (
        <KnowledgeBaseDialog
          assistant={activeAssistant}
          memories={activeAssistantMemories}
          notes={activeAssistantNotes}
          onClose={() => setKnowledgeOpen(false)}
          onCopy={copyMessage}
          onDelete={deleteNote}
          onDeleteMemory={deleteAssistantMemory}
          onReference={referenceKnowledgeNote}
          onSaveMemory={saveAssistantMemory}
        />
      )}
      {toolCenterOpen && (
        <ToolConfigDialog
          tools={tools}
          onClose={() => setToolCenterOpen(false)}
          onDelete={deleteToolConfig}
          onSave={saveToolConfig}
        />
      )}
      {spaceCenterOpen && (
        <SpaceCenterDialog
          activeSpaceId={activeProjectId}
          spaces={projects}
          onClose={() => setSpaceCenterOpen(false)}
          onCreate={createSpace}
          onRename={renameSpace}
          onSwitch={switchSpace}
        />
      )}
      {conversationSearchOpen && (
        <ConversationSearchDialog
          error={conversationSearchError}
          loading={conversationSearchLoading}
          query={conversationSearchQuery}
          response={conversationSearchResponse}
          onClose={() => setConversationSearchOpen(false)}
          onQueryChange={setConversationSearchQuery}
          onSearch={runConversationSearch}
          onSelect={openConversationSearchResult}
        />
      )}
      {agreementOpen && settings && (
        <UserAgreementDialog
          onAccept={() => void acceptUserAgreement()}
          onRecoverData={() => void recoverExistingDataDirectory()}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          appVersion={appVersion}
          appBuildCode={appBuildCode}
          initialTab={settingsInitialTab}
          dataLocation={dataLocation}
          settings={settings}
          providers={providers}
          goldThemeEntitled={goldThemeEntitled}
          goldThemeEntitlementChecked={goldThemeEntitlementChecked}
          onClose={() => {
            setSettingsOpen(false)
            setSettingsInitialTab('providers')
          }}
          onSaveSettings={saveSettings}
          onSaveProvider={saveProvider}
          onCheckProvider={checkProvider}
          onCheckThemeEntitlement={checkThemeEntitlement}
          onRefreshProviderModels={refreshProviderModels}
          onDeleteProvider={deleteProvider}
          onDataLocationChange={setDataLocation}
        />
      )}
      {localTaskPlan && (
        <LocalTaskPanel
          plan={localTaskPlan}
          progress={localTaskProgress}
          result={localTaskResult}
          running={localTaskRunning}
          onApprove={() => void executePendingLocalTask()}
          onCancel={() => void window.gllm.cancelLocalFileTask(localTaskPlan.id)}
          onClose={closeLocalTask}
          onOpenOutput={(planId) => void window.gllm.openLocalTaskOutput(planId)}
        />
      )}
    </div>
  )
}

function HiddenAssistantsDialog({
  assistants,
  onClose,
  onDelete,
  onRestore
}: {
  assistants: Assistant[]
  onClose: () => void
  onDelete: (assistant: Assistant) => Promise<void>
  onRestore: (assistant: Assistant) => Promise<void>
}) {
  const { t } = useTranslation()
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function runAction(assistant: Assistant, action: 'restore' | 'delete') {
    setPendingId(assistant.id)
    try {
      if (action === 'restore') await onRestore(assistant)
      else await onDelete(assistant)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="hidden-assistants-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>G-LLM</p>
            <h2>{t('assistantActions.hiddenTitle')}</h2>
          </div>
          <button className="icon-button compact" onClick={onClose} title={t('common.close')} type="button">
            <X size={16} />
          </button>
        </header>
        <p className="hidden-assistants-description">{t('assistantActions.hiddenDescription')}</p>
        <div className="hidden-assistants-list">
          {assistants.length === 0 && <div className="assistant-empty">{t('assistantActions.noHidden')}</div>}
          {assistants.map((assistant) => {
            const displayAssistant = localizeAssistant(assistant)
            const pending = pendingId === assistant.id
            return (
              <article className="hidden-assistant-row" key={assistant.id}>
                <AssistantAvatar assistant={assistant} />
                <span>
                  <strong>{displayAssistant.name}</strong>
                  <small>{displayAssistant.title}</small>
                </span>
                <div>
                  <button className="secondary-action" disabled={pending} onClick={() => void runAction(assistant, 'restore')} type="button">
                    <Eye size={15} />
                    {t('assistantActions.restore')}
                  </button>
                  <button className="danger-action" disabled={pending} onClick={() => void runAction(assistant, 'delete')} type="button">
                    <Trash2 size={15} />
                    {t('assistantActions.delete')}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </ModalBackdrop>
  )
}

function formatConversationSearchDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

function ConversationSearchDialog({
  error,
  loading,
  query,
  response,
  onClose,
  onQueryChange,
  onSearch,
  onSelect
}: {
  error: string
  loading: boolean
  query: string
  response: ConversationSearchResponse | null
  onClose: () => void
  onQueryChange: (query: string) => void
  onSearch: (query: string) => Promise<void>
  onSelect: (result: ConversationSearchResult) => Promise<void>
}) {
  const { t, i18n } = useTranslation()

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onSearch(query)
  }

  const statusText = loading
    ? t('conversationSearch.searching')
    : response?.mode === 'semantic'
      ? t('conversationSearch.semanticStatus', { count: response.searchedCount })
      : response?.mode === 'local'
        ? t('conversationSearch.localStatus', { count: response.searchedCount })
        : response
          ? t('conversationSearch.recentStatus', { count: response.searchedCount })
          : ''

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="conversation-search-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>{t('conversationSearch.eyebrow')}</p>
            <h2>{t('conversationSearch.title')}</h2>
          </div>
          <button className="icon-button compact" onClick={onClose} title={t('common.close')} type="button">
            <X size={16} />
          </button>
        </header>

        <form className="conversation-search-form" onSubmit={submitSearch}>
          <Search size={17} />
          <input
            autoFocus
            value={query}
            maxLength={300}
            placeholder={t('conversationSearch.placeholder')}
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {query && (
            <button className="conversation-search-clear" onClick={() => onQueryChange('')} title={t('common.clear')} type="button">
              <X size={14} />
            </button>
          )}
          <button className="primary-button conversation-search-submit" disabled={loading} type="submit">
            <Sparkles size={15} />
            <span>{t('conversationSearch.submit')}</span>
          </button>
        </form>

        <div className="conversation-search-status" aria-live="polite">
          <span>{error || statusText}</span>
        </div>

        <div className="conversation-search-results">
          {!loading && response?.results.length === 0 && (
            <div className="conversation-search-empty">
              <Search size={22} />
              <strong>{t('conversationSearch.emptyTitle')}</strong>
              <span>{t('conversationSearch.emptyDescription')}</span>
            </div>
          )}
          {response?.results.map((result) => (
            <button
              className="conversation-search-result"
              key={result.conversationId}
              onClick={() => void onSelect(result)}
              type="button"
            >
              <span className="conversation-search-result-heading">
                <strong>{result.title || t('conversationSearch.untitled')}</strong>
                <time>{formatConversationSearchDate(result.updatedAt, i18n.resolvedLanguage ?? 'zh-CN')}</time>
              </span>
              <span className="conversation-search-result-meta">
                {result.projectName} · {result.assistantName}
              </span>
              <span className="conversation-search-result-snippet">{result.snippet}</span>
              {result.reason && <span className="conversation-search-result-reason">{result.reason}</span>}
            </button>
          ))}
        </div>
      </section>
    </ModalBackdrop>
  )
}

function SpaceCenterDialog({
  spaces,
  activeSpaceId,
  onClose,
  onCreate,
  onRename,
  onSwitch
}: {
  spaces: Project[]
  activeSpaceId: string
  onClose: () => void
  onCreate: (payload: SpaceFormPayload) => Promise<void>
  onRename: (spaceId: string, payload: SpaceFormPayload) => Promise<void>
  onSwitch: (spaceId: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(spaces.length <= 1)
  const [newName, setNewName] = useState(() => t('spaces.initialName'))
  const [newDescription, setNewDescription] = useState('')
  const [newLogoDataUrl, setNewLogoDataUrl] = useState('')
  const [newWorkspacePath, setNewWorkspacePath] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editLogoDataUrl, setEditLogoDataUrl] = useState('')
  const [editWorkspacePath, setEditWorkspacePath] = useState('')
  const [savingAction, setSavingAction] = useState<string | null>(null)
  const [error, setError] = useState('')
  const newLogoInputRef = useRef<HTMLInputElement>(null)
  const editLogoInputRef = useRef<HTMLInputElement>(null)
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? spaces[0] ?? null
  const hasMultipleSpaces = spaces.length > 1

  function startRename(space: Project) {
    setRenamingId(space.id)
    setEditName(getSpaceName(space))
    setEditDescription(space.description ?? '')
    setEditLogoDataUrl(space.logoDataUrl ?? '')
    setEditWorkspacePath(space.workspacePath ?? '')
    setError('')
  }

  async function chooseWorkspace(target: 'create' | 'edit') {
    try {
      const path = await window.gllm.chooseWorkspaceDirectory()
      if (!path) return
      if (target === 'create') setNewWorkspacePath(path)
      else setEditWorkspacePath(path)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('spaces.errors.chooseWorkspace'))
    }
  }

  async function chooseSpaceLogo(event: ChangeEvent<HTMLInputElement>, target: 'create' | 'edit') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError(t('spaces.errors.imageOnly'))
      return
    }

    if (file.size > 8 * 1024 * 1024) {
      setError(t('spaces.errors.imageTooLarge'))
      return
    }

    try {
      const source = await readFileAsDataUrl(file)
      const cropped = await cropImageToSquareDataUrl(source, 1)
      if (target === 'create') {
        setNewLogoDataUrl(cropped)
      } else {
        setEditLogoDataUrl(cropped)
      }
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('spaces.errors.imageRead'))
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) {
      setError(t('spaces.errors.nameRequired'))
      return
    }

    setSavingAction('create')
    setError('')
    try {
      await onCreate({ name, description: newDescription, logoDataUrl: newLogoDataUrl || undefined, workspacePath: newWorkspacePath || undefined })
      setCreating(false)
      setNewName(t('spaces.newSpace'))
      setNewDescription('')
      setNewLogoDataUrl('')
      setNewWorkspacePath('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('spaces.errors.create'))
    } finally {
      setSavingAction(null)
    }
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renamingId) return

    const name = editName.trim()
    if (!name) {
      setError(t('spaces.errors.nameRequired'))
      return
    }

    setSavingAction(renamingId)
    setError('')
    try {
      await onRename(renamingId, { name, description: editDescription, logoDataUrl: editLogoDataUrl || undefined, workspacePath: editWorkspacePath || undefined })
      setRenamingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('spaces.errors.save'))
    } finally {
      setSavingAction(null)
    }
  }

  async function handleSwitch(spaceId: string) {
    setSavingAction(`switch:${spaceId}`)
    setError('')
    try {
      await onSwitch(spaceId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('spaces.errors.switch'))
    } finally {
      setSavingAction(null)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="space-center-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>{t('spaces.title')}</p>
            <h2>{getSpaceName(activeSpace)}</h2>
          </div>
          <button className="icon-button compact" onClick={onClose} title={t('common.close')} type="button">
            <X size={16} />
          </button>
        </header>

        <div className="space-center-body">
        <div className="space-current-card">
          <SpaceLogo className="large" project={activeSpace} />
          <div>
            <span>{t('spaces.currentSpace')}</span>
            <strong>{getSpaceName(activeSpace)}</strong>
            <p>{getSpaceDescription(activeSpace)}</p>
          </div>
          <em>{activeSpace?.id === defaultSpaceId ? t('app.defaultSpace') : t('app.independentSpace')}</em>
        </div>

        <section className="space-guidance">
          <div>
            <h3>{hasMultipleSpaces ? t('spaces.whySpaces') : t('spaces.whySecondSpace')}</h3>
            <p>{t('spaces.guidance')}</p>
          </div>
          <div className="space-insight-grid">
            <article>
              <Database size={17} />
              <strong>{t('spaces.isolatedContent')}</strong>
              <span>{t('spaces.isolatedContentDescription')}</span>
            </article>
            <article>
              <KeyRound size={17} />
              <strong>{t('spaces.sharedSettings')}</strong>
              <span>{t('spaces.sharedSettingsDescription')}</span>
            </article>
            <article>
              <FolderOpen size={17} />
              <strong>{t('spaces.useCases')}</strong>
              <span>{t('spaces.useCasesDescription')}</span>
            </article>
          </div>
          {hasMultipleSpaces && (
            <div className="space-switch-note">
              <CircleCheck size={15} />
              <span>{t('spaces.switchNote', { space: getSpaceName(activeSpace) })}</span>
            </div>
          )}
        </section>

        {hasMultipleSpaces && (
          <section className="space-list-section">
            <div className="space-section-heading">
              <h3>{t('spaces.allSpaces')}</h3>
              <button className="secondary-action" onClick={() => setCreating((current) => !current)} type="button">
                <Plus size={15} />
                {t('spaces.createNew')}
              </button>
            </div>
            <div className="space-list">
              {spaces.map((space) => {
                const active = space.id === activeSpaceId
                const saving = savingAction === space.id || savingAction === `switch:${space.id}`

                return (
                  <article className={`space-row ${active ? 'active' : ''}`} key={space.id}>
                    {renamingId === space.id ? (
                      <form className="space-edit-form" onSubmit={handleRename}>
                        <div className="space-logo-editor">
                          <SpaceLogo className="editable" project={{ ...space, logoDataUrl: editLogoDataUrl || undefined }} />
                          <div>
                            <strong>{space.id === defaultSpaceId ? t('spaces.defaultLogo') : t('spaces.logo')}</strong>
                            <span>
                              {space.id === defaultSpaceId
                                ? t('spaces.defaultLogoDescription')
                                : t('spaces.logoDescription')}
                            </span>
                            {space.id !== defaultSpaceId && (
                              <div className="space-logo-actions">
                                <input
                                  ref={editLogoInputRef}
                                  accept="image/*"
                                  hidden
                                  type="file"
                                  onChange={(event) => void chooseSpaceLogo(event, 'edit')}
                                />
                                <button className="secondary-action" onClick={() => editLogoInputRef.current?.click()} type="button">
                                  {t('spaces.uploadLogo')}
                                </button>
                                <button
                                  className="secondary-action"
                                  disabled={!editLogoDataUrl}
                                  onClick={() => setEditLogoDataUrl('')}
                                  type="button"
                                >
                                  {t('common.remove')}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <label>
                          <span>{t('spaces.name')}</span>
                          <input value={editName} onChange={(event) => setEditName(event.target.value)} />
                        </label>
                        <label>
                          <span>{t('spaces.description')}</span>
                          <textarea
                            value={editDescription}
                            onChange={(event) => setEditDescription(event.target.value)}
                            placeholder={t('spaces.description')}
                            rows={2}
                          />
                        </label>
                        <div className="space-workspace-field">
                          <span>{t('spaces.workspace')}</span>
                          <strong title={editWorkspacePath}>{editWorkspacePath || t('spaces.notBound')}</strong>
                          <div>
                            <button className="secondary-action" onClick={() => void chooseWorkspace('edit')} type="button"><FolderOpen size={15} />{t('spaces.chooseDirectory')}</button>
                            <button className="secondary-action" disabled={!editWorkspacePath} onClick={() => setEditWorkspacePath('')} type="button">{t('spaces.unbind')}</button>
                          </div>
                          <small>{t('spaces.workspaceDescription')}</small>
                        </div>
                        <div className="space-form-actions">
                          <button className="secondary-action" onClick={() => setRenamingId(null)} type="button">
                            {t('common.cancel')}
                          </button>
                          <button className="primary-action" disabled={saving || !editName.trim()} type="submit">
                            {t('common.save')}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <SpaceLogo project={space} />
                        <div className="space-row-main">
                          <strong>{getSpaceName(space)}</strong>
                          <span>{getSpaceDescription(space)}</span>
                        </div>
                        <div className="space-row-actions">
                          {active && (
                            <span className="space-active-badge">
                              <CircleCheck size={14} />
                              {t('common.current')}
                            </span>
                          )}
                          {!active && (
                            <button
                              className="secondary-action"
                              disabled={saving}
                              onClick={() => void handleSwitch(space.id)}
                              type="button"
                            >
                              {t('spaces.switch')}
                            </button>
                          )}
                          <button className="icon-button compact" onClick={() => startRename(space)} title={t('spaces.rename')} type="button">
                            <Pencil size={15} />
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        )}

        {(creating || !hasMultipleSpaces) && (
          <form className="space-create-form" onSubmit={handleCreate}>
            <div>
              <h3>{hasMultipleSpaces ? t('spaces.createNew') : t('spaces.createSecond')}</h3>
              <p>{t('spaces.createDescription')}</p>
            </div>
            <div className="space-logo-editor">
              <SpaceLogo
                className="editable"
                project={{
                  id: 'space_preview',
                  name: newName || t('spaces.newSpace'),
                  description: newDescription,
                  logoDataUrl: newLogoDataUrl || undefined,
                  createdAt: 0,
                  updatedAt: 0
                }}
              />
              <div>
                <strong>{t('spaces.logo')}</strong>
                <span>{t('spaces.optionalLogoDescription')}</span>
                <div className="space-logo-actions">
                  <input
                    ref={newLogoInputRef}
                    accept="image/*"
                    hidden
                    type="file"
                    onChange={(event) => void chooseSpaceLogo(event, 'create')}
                  />
                  <button className="secondary-action" onClick={() => newLogoInputRef.current?.click()} type="button">
                    {t('spaces.uploadLogo')}
                  </button>
                  <button className="secondary-action" disabled={!newLogoDataUrl} onClick={() => setNewLogoDataUrl('')} type="button">
                    {t('common.remove')}
                  </button>
                </div>
              </div>
            </div>
            <label>
              <span>{t('spaces.name')}</span>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('spaces.namePlaceholder')} />
            </label>
            <label>
              <span>{t('spaces.description')}</span>
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder={t('spaces.optional')}
                rows={2}
              />
            </label>
            <div className="space-workspace-field">
              <span>{t('spaces.workspace')}</span>
              <strong title={newWorkspacePath}>{newWorkspacePath || t('spaces.workspaceOptional')}</strong>
              <div>
                <button className="secondary-action" onClick={() => void chooseWorkspace('create')} type="button"><FolderOpen size={15} />{t('spaces.chooseDirectory')}</button>
                <button className="secondary-action" disabled={!newWorkspacePath} onClick={() => setNewWorkspacePath('')} type="button">{t('common.clear')}</button>
              </div>
              <small>{t('spaces.localPathDescription')}</small>
            </div>
            {error && <p className="space-error">{error}</p>}
            <div className="space-form-actions">
              {hasMultipleSpaces && (
                <button className="secondary-action" onClick={() => setCreating(false)} type="button">
                  {t('common.cancel')}
                </button>
              )}
              <button className="primary-action" disabled={savingAction === 'create' || !newName.trim()} type="submit">
                {savingAction === 'create' ? t('spaces.creating') : t('spaces.create')}
              </button>
            </div>
          </form>
        )}

        {error && hasMultipleSpaces && !creating && <p className="space-error">{error}</p>}
        </div>
      </section>
    </ModalBackdrop>
  )
}

function UserAgreementDialog({ onAccept, onRecoverData }: { onAccept: () => void; onRecoverData: () => void }) {
  const { t } = useTranslation()
  const [recoverHintVisible, setRecoverHintVisible] = useState(false)

  return (
    <div className="assistant-modal-backdrop agreement-backdrop">
      <section className="agreement-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>G-LLM</p>
            <h2>{t('agreement.title')}</h2>
          </div>
        </header>

        <div className="agreement-content">
          <p>{t('agreement.intro')}</p>
          <section>
            <strong>{t('agreement.localDataTitle')}</strong>
            <p>{t('agreement.localData')}</p>
            {recoverHintVisible && (
              <p className="agreement-recover-hint">
                {t('agreement.recoverHint')}
              </p>
            )}
          </section>
          <section>
            <strong>{t('agreement.modelServiceTitle')}</strong>
            <p>{t('agreement.modelService')}</p>
          </section>
          <section>
            <strong>{t('agreement.responsibilityTitle')}</strong>
            <p>{t('agreement.responsibility')}</p>
          </section>
          <section>
            <strong>{t('agreement.telemetryTitle')}</strong>
            <p>{t('agreement.telemetry')}</p>
          </section>
        </div>

        <div className="agreement-actions">
          <button
            className="secondary-action"
            onClick={() => {
              setRecoverHintVisible(true)
              onRecoverData()
            }}
            type="button"
          >
            {t('agreement.recover')}
          </button>
          <button className="primary-action" onClick={onAccept} type="button">
            {t('agreement.accept')}
          </button>
        </div>
      </section>
    </div>
  )
}

function AssistantSettingsDialog({
  assistant,
  onClose,
  onSave
}: {
  assistant: Assistant
  onClose: () => void
  onSave: (assistant: Assistant) => Promise<Assistant>
}) {
  const { t } = useTranslation()
  const builtInAssistant = DEFAULT_ASSISTANTS.find((item) => item.id === assistant.id)
  const [name, setName] = useState(assistant.name)
  const [title, setTitle] = useState(assistant.title)
  const [tone, setTone] = useState(assistant.tone)
  const [avatarDataUrl, setAvatarDataUrl] = useState(assistant.avatarDataUrl ?? '')
  const [avatarSourceDataUrl, setAvatarSourceDataUrl] = useState('')
  const [avatarZoom, setAvatarZoom] = useState(1)
  const [systemPrompt, setSystemPrompt] = useState(assistant.systemPrompt)
  const [starterPromptText, setStarterPromptText] = useState(assistant.starterPrompts.join('\n'))
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const previewAssistant: Assistant = { ...assistant, name, title, tone, avatarDataUrl: avatarDataUrl || undefined }
  const starterPrompts = starterPromptText
    .split('\n')
    .map((prompt) => prompt.trim())
    .filter(Boolean)
    .slice(0, 6)
  const changed =
    name.trim() !== assistant.name ||
    title.trim() !== assistant.title ||
    tone.trim() !== assistant.tone ||
    (avatarDataUrl || undefined) !== (assistant.avatarDataUrl || undefined) ||
    systemPrompt.trim() !== assistant.systemPrompt ||
    starterPrompts.join('\n') !== assistant.starterPrompts.join('\n')

  useEffect(() => {
    if (!avatarSourceDataUrl) return

    let disposed = false
    cropImageToSquareDataUrl(avatarSourceDataUrl, avatarZoom)
      .then((dataUrl) => {
        if (!disposed) setAvatarDataUrl(dataUrl)
      })
      .catch((error) => {
        if (!disposed) setStatus(error instanceof Error ? error.message : t('assistantSettings.errors.crop'))
      })

    return () => {
      disposed = true
    }
  }, [avatarSourceDataUrl, avatarZoom])

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setStatus(t('assistantSettings.errors.imageOnly'))
      return
    }

    if (file.size > 8 * 1024 * 1024) {
      setStatus(t('assistantSettings.errors.imageTooLarge'))
      return
    }

    try {
      const source = await readFileAsDataUrl(file)
      const cropped = await cropImageToSquareDataUrl(source, 1)
      setAvatarZoom(1)
      setAvatarSourceDataUrl(source)
      setAvatarDataUrl(cropped)
      setStatus(t('assistantSettings.previewReady'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('assistantSettings.errors.imageRead'))
    }
  }

  async function save() {
    const nextPrompt = systemPrompt.trim()
    if (!nextPrompt) {
      setStatus(t('assistantSettings.errors.promptRequired'))
      return
    }

    setSaving(true)
    setStatus(t('assistantSettings.saving'))
    try {
      await onSave({
        ...assistant,
        name: name.trim() || assistant.name,
        title: title.trim() || assistant.title,
        tone: tone.trim() || assistant.tone,
        systemPrompt: nextPrompt,
        starterPrompts: starterPrompts.length > 0 ? starterPrompts : assistant.starterPrompts,
        avatarDataUrl: avatarDataUrl || undefined,
        updatedAt: Date.now()
      })
      setStatus(t('assistantSettings.saved'))
      onClose()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  function restoreBuiltInPrompt() {
    if (!builtInAssistant) return
    setSystemPrompt(builtInAssistant.systemPrompt)
    setStatus(t('assistantSettings.promptRestored'))
  }

  function restoreDefaultAvatar() {
    setAvatarSourceDataUrl('')
    setAvatarDataUrl('')
    setAvatarZoom(1)
    setStatus(t('assistantSettings.avatarRestored'))
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="assistant-settings-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>{assistant.builtIn ? t('assistantSettings.builtIn') : t('assistantSettings.custom')}</p>
            <h2>{t('assistantSettings.title')}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title={t('common.close')} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="assistant-settings-form">
          <div className="assistant-avatar-editor">
            <AssistantAvatar assistant={previewAssistant} className="large" />
            <div>
              <strong>{t('assistantSettings.avatar')}</strong>
              <p>{t('assistantSettings.avatarDescription')}</p>
              <input ref={avatarInputRef} accept="image/*" hidden type="file" onChange={(event) => void chooseAvatar(event)} />
              <div className="assistant-avatar-actions">
                <button className="secondary-action" disabled={saving} onClick={() => avatarInputRef.current?.click()} type="button">
                  {t('assistantSettings.uploadImage')}
                </button>
                <button className="secondary-action" disabled={saving || !avatarDataUrl} onClick={restoreDefaultAvatar} type="button">
                  {t('assistantSettings.restoreAvatar')}
                </button>
              </div>
              {avatarSourceDataUrl && (
                <label className="assistant-avatar-zoom">
                  <span>{t('assistantSettings.cropZoom')}</span>
                  <input
                    max="2.5"
                    min="1"
                    step="0.01"
                    type="range"
                    value={avatarZoom}
                    onChange={(event) => setAvatarZoom(Number(event.target.value))}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="form-row two">
            <label>
              <span>{t('assistantSettings.name')}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>{t('assistantSettings.tone')}</span>
              <input value={tone} onChange={(event) => setTone(event.target.value)} />
            </label>
          </div>

          <label>
            <span>{t('assistantSettings.description')}</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label>
            <span>{t('assistantSettings.systemPrompt')}</span>
            <textarea
              className="assistant-prompt-textarea"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </label>

          <label>
            <span>{t('assistantSettings.starters')}</span>
            <textarea
              className="assistant-starters-textarea"
              value={starterPromptText}
              onChange={(event) => setStarterPromptText(event.target.value)}
            />
          </label>

          <div className="assistant-settings-note">
            {t('assistantSettings.promptNote')}
          </div>

          {status && <div className="assistant-status">{status}</div>}
        </div>

        <div className="form-actions assistant-settings-actions">
          <button className="secondary-action" disabled={!builtInAssistant || saving} onClick={restoreBuiltInPrompt} type="button">
            {t('assistantSettings.restorePrompt')}
          </button>
          <button className="secondary-action" disabled={saving} onClick={onClose} type="button">
            {t('settings.closeWithoutSaving')}
          </button>
          <button className="primary-action" disabled={saving || !changed} onClick={() => void save()} type="button">
            <Save size={17} />
            {t('assistantSettings.save')}
          </button>
        </div>
      </section>
    </ModalBackdrop>
  )
}

function AddAssistantDialog({
  globalProviderId,
  providers,
  onClose,
  onSave,
  onSuggest
}: {
  globalProviderId: string
  providers: ApiProvider[]
  onClose: () => void
  onSave: (assistant: Assistant) => Promise<Assistant>
  onSuggest: (keyword: string, provider: ApiProvider) => Promise<AssistantSuggestion>
}) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState('')
  const [activePresetCategory, setActivePresetCategory] = useState(ASSISTANT_PRESET_CATEGORIES[0])
  const [providerId, setProviderId] = useState(globalProviderId)
  const selectedProvider = getProviderById(providerId, providers)
  const [modelId, setModelId] = useState(selectedProvider.defaultModel)
  const [assistantStatus, setAssistantStatus] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const modelOptions = getModelOptions(selectedProvider, modelId)
  const selectedModel = modelId.trim() || selectedProvider.defaultModel.trim()
  const aiGenerateUnavailableReason = !selectedModel
    ? t('addAssistant.selectModel')
    : selectedProvider.requiresApiKey && !selectedProvider.apiKey.trim()
      ? t('addAssistant.apiKeyRequired', { provider: selectedProvider.name })
      : ''
  const canGenerateAssistant = !isWorking && Boolean(keyword.trim()) && !aiGenerateUnavailableReason
  const visiblePresets = keyword.trim()
    ? searchLocalizedAssistantPresets(keyword, '')
    : searchLocalizedAssistantPresets('', activePresetCategory)

  function selectProvider(nextProviderId: string) {
    const nextProvider = getProviderById(nextProviderId, providers)
    setProviderId(nextProvider.id)
    setModelId(nextProvider.defaultModel)
  }

  function createAssistantFromSuggestion(suggestion: AssistantSuggestion): Assistant {
    const now = Date.now()

    return {
      id: createId('assistant'),
      name: suggestion.name,
      title: suggestion.title,
      tone: suggestion.tone,
      color: suggestion.color,
      icon: suggestion.icon,
      systemPrompt: suggestion.systemPrompt,
      starterPrompts: suggestion.starterPrompts,
      modelProviderId: selectedProvider.id,
      modelId: selectedModel,
      builtIn: false,
      createdAt: now,
      updatedAt: now
    }
  }

  async function addAssistant(suggestion: AssistantSuggestion, pendingMessage: string) {
    if (isWorking) return
    setIsWorking(true)
    setAssistantStatus(pendingMessage)

    try {
      const saved = await onSave(createAssistantFromSuggestion(suggestion))
      setAssistantStatus(t('addAssistant.added', { assistant: saved.name }))
      onClose()
    } catch (error) {
      setAssistantStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsWorking(false)
    }
  }

  async function usePresetAssistant(preset: AssistantPreset) {
    await addAssistant(preset, t('addAssistant.adding', { assistant: preset.name }))
  }

  async function generateAssistant(nextKeyword = keyword) {
    const text = nextKeyword.trim()
    if (!text) {
      setAssistantStatus(t('addAssistant.keywordRequired'))
      return
    }

    if (aiGenerateUnavailableReason) {
      setAssistantStatus(aiGenerateUnavailableReason)
      return
    }

    const matchedPreset = findLocalizedAssistantPreset(text)
    if (matchedPreset) {
      setActivePresetCategory(matchedPreset.featured ? '精选' : matchedPreset.category)
      await usePresetAssistant(matchedPreset)
      return
    }

    if (isWorking) return
    setIsWorking(true)
    setAssistantStatus(t('addAssistant.generating', { keyword: text }))

    try {
      const suggestion = await onSuggest(text, {
        ...selectedProvider,
        defaultModel: selectedModel,
        models: getModelOptions(selectedProvider, selectedModel)
      })
      const saved = await onSave(createAssistantFromSuggestion(suggestion))
      setAssistantStatus(t('addAssistant.added', { assistant: saved.name }))
      onClose()
    } catch (error) {
      setAssistantStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="add-assistant-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>G-LLM</p>
            <h2>{t('addAssistant.title')}</h2>
          </div>
          <div className="header-actions">
            <button className="icon-button" onClick={onClose} title={t('common.close')}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="assistant-simple-search">
          <input
            autoFocus
            placeholder={t('addAssistant.searchPlaceholder')}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void generateAssistant()
              }
            }}
          />
          <button
            className="assistant-ai-generate-button"
            disabled={!canGenerateAssistant}
            onClick={() => void generateAssistant()}
            title={
              aiGenerateUnavailableReason ||
              (keyword.trim()
                ? t('addAssistant.generateTitle', { provider: selectedProvider.name, model: selectedModel })
                : t('addAssistant.keywordRequired'))
            }
            type="button"
          >
            <Sparkles size={16} />
            {t('addAssistant.generate')}
          </button>
        </div>

        <div className="assistant-create-model">
          <label>
            <span>{t('addAssistant.provider')}</span>
            <select value={providerId} onChange={(event) => selectProvider(event.target.value)}>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('modelPicker.model')}</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {getModelDisplayLabel(model)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!keyword.trim() && (
          <div className="preset-category-tabs">
            {ASSISTANT_PRESET_CATEGORIES.map((category) => (
              <button
                key={category}
                className={category === activePresetCategory ? 'active' : ''}
                onClick={() => setActivePresetCategory(category)}
                type="button"
              >
                {localizeAssistantPresetCategory(category)}
              </button>
            ))}
          </div>
        )}

        <div className="assistant-preset-results">
          {visiblePresets.slice(0, 12).map((preset) => {
            const Icon = iconMap[preset.icon]

            return (
              <button
                key={preset.id}
                className={`assistant-preset-card ${preset.color}`}
                disabled={isWorking}
                onClick={() => void usePresetAssistant(preset)}
                type="button"
              >
                <span className={`assistant-icon ${preset.color}`}>
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{preset.name}</strong>
                  <small>{preset.title}</small>
                  <em>{preset.description}</em>
                </span>
                <b>{t('common.add')}</b>
              </button>
            )
          })}

          {visiblePresets.length === 0 && (
            <div className="preset-empty">{t('addAssistant.empty')}</div>
          )}
        </div>

        {assistantStatus && <div className="assistant-status">{assistantStatus}</div>}
      </section>
    </ModalBackdrop>
  )
}

function ConversationModelDialog({
  conversation,
  assistant,
  globalProviderId,
  providers,
  onClose,
  onSaveAssistant,
  onSaveConversation
}: {
  conversation: Conversation
  assistant: Assistant
  globalProviderId: string
  providers: ApiProvider[]
  onClose: () => void
  onSaveAssistant: (assistant: Assistant) => Promise<Assistant>
  onSaveConversation: (conversation: Conversation) => void
}) {
  const { t } = useTranslation()
  const displayAssistant = localizeAssistant(assistant)
  const globalProvider = getProviderById(globalProviderId, providers)
  const assistantProvider = getEffectiveProvider(assistant, globalProvider, providers)
  const initialProviderId =
    conversation.modelProviderId && providers.some((provider) => provider.id === conversation.modelProviderId)
      ? conversation.modelProviderId
      : assistantProvider.id
  const [providerId, setProviderId] = useState(initialProviderId)
  const selectedProvider = getProviderById(providerId, providers)
  const [modelId, setModelId] = useState(conversation.modelId || assistantProvider.defaultModel)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  function selectProvider(nextProviderId: string) {
    const nextProvider = getProviderById(nextProviderId, providers)
    setProviderId(nextProvider.id)
    setModelId(nextProvider.defaultModel)
  }

  function saveConversationModel(useAssistantDefault = false) {
    setSaving(true)
    setStatus(useAssistantDefault ? t('conversationModel.usingDefault') : t('conversationModel.savingConversation'))

    try {
      const nextProvider = useAssistantDefault ? assistantProvider : selectedProvider
      onSaveConversation({
        ...conversation,
        modelProviderId: nextProvider.id,
        modelId: useAssistantDefault ? assistantProvider.defaultModel : modelId,
        updatedAt: Date.now()
      })
      setStatus(
        useAssistantDefault
          ? t('conversationModel.defaultApplied', { model: assistantProvider.defaultModel })
          : t('conversationModel.conversationApplied', { provider: selectedProvider.name, model: modelId })
      )
      onClose()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function saveAsAssistantDefault() {
    setSaving(true)
    setStatus(t('conversationModel.savingDefault'))

    try {
      const saved = await onSaveAssistant({
        ...assistant,
        modelProviderId: selectedProvider.id,
        modelId
      })
      setStatus(t('conversationModel.defaultSaved', { assistant: saved.name, provider: selectedProvider.name, model: modelId }))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="assistant-model-modal" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>{displayAssistant.name}</p>
            <h2>{t('conversationModel.title')}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        <div className="assistant-model-note">
          {t('conversationModel.note', {
            conversation: conversation.title,
            provider: assistantProvider.name,
            model: assistantProvider.defaultModel
          })}
        </div>

        <label>
          <span>{t('addAssistant.provider')}</span>
          <select value={providerId} onChange={(event) => selectProvider(event.target.value)}>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>

        <ModelPickerMenu provider={selectedProvider} value={modelId} onChange={setModelId} />

        <div className="form-actions">
          <button className="secondary-action" disabled={saving} onClick={() => saveConversationModel(true)} type="button">
            {t('conversationModel.useDefault')}
          </button>
          <button className="secondary-action" disabled={saving || !modelId.trim()} onClick={() => void saveAsAssistantDefault()} type="button">
            {t('conversationModel.saveDefault')}
          </button>
          <button className="primary-action" disabled={saving || !modelId.trim()} onClick={() => saveConversationModel()} type="button">
            <Save size={17} />
            {t('conversationModel.saveConversation')}
          </button>
        </div>

        {status && <div className="assistant-status">{status}</div>}
      </section>
    </ModalBackdrop>
  )
}

function KnowledgeBaseDialog({
  assistant,
  memories,
  notes,
  onClose,
  onCopy,
  onDelete,
  onDeleteMemory,
  onReference,
  onSaveMemory
}: {
  assistant: Assistant
  memories: AssistantMemory[]
  notes: KnowledgeNote[]
  onClose: () => void
  onCopy: (content: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDeleteMemory: (id: string) => Promise<void>
  onReference: (note: KnowledgeNote) => void
  onSaveMemory: (memory: AssistantMemory) => Promise<AssistantMemory>
}) {
  const { t, i18n } = useTranslation()
  const displayAssistant = localizeAssistant(assistant)
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'knowledge' | 'memory'>('knowledge')
  const [memoryDraft, setMemoryDraft] = useState('')
  const [status, setStatus] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const visibleNotes = normalizedQuery
    ? notes.filter((note) => `${note.title}\n${note.content}`.toLowerCase().includes(normalizedQuery))
    : notes
  const visibleMemories = normalizedQuery
    ? memories.filter((memory) => memory.content.toLowerCase().includes(normalizedQuery))
    : memories

  async function addMemory(content: string, source?: Pick<AssistantMemory, 'sourceNoteId' | 'sourceMessageId'>) {
    const text = content.trim()
    if (!text) {
      setStatus(t('knowledge.memoryRequired'))
      return
    }

    const now = Date.now()
    try {
      const saved = await onSaveMemory({
        id: createId('memory'),
        assistantId: assistant.id,
        content: text,
        enabled: true,
        sourceNoteId: source?.sourceNoteId,
        sourceMessageId: source?.sourceMessageId,
        createdAt: now,
        updatedAt: now
      })
      setStatus(t('knowledge.memoryAdded', { content: saved.content.slice(0, 28) }))
      setMemoryDraft('')
      setActiveTab('memory')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function toggleMemory(memory: AssistantMemory) {
    try {
      const saved = await onSaveMemory({ ...memory, enabled: !memory.enabled, updatedAt: Date.now() })
      setStatus(saved.enabled ? t('knowledge.memoryEnabled') : t('knowledge.memoryDisabled'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeMemory(memory: AssistantMemory) {
    try {
      await onDeleteMemory(memory.id)
      setStatus(t('knowledge.memoryDeleted'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="knowledge-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>{displayAssistant.name}</p>
            <h2>{t('knowledge.title')}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        <div className="knowledge-tabs">
          <button className={activeTab === 'knowledge' ? 'active' : ''} onClick={() => setActiveTab('knowledge')} type="button">
            {t('knowledge.knowledgeTab')}
          </button>
          <button className={activeTab === 'memory' ? 'active' : ''} onClick={() => setActiveTab('memory')} type="button">
            {t('knowledge.memoryTab')}
          </button>
        </div>

        <div className="knowledge-search">
          <input
            autoFocus
            placeholder={activeTab === 'knowledge' ? t('knowledge.searchKnowledge') : t('knowledge.searchMemory')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {activeTab === 'knowledge' ? (
          <div className="knowledge-list">
            {visibleNotes.length === 0 && <div className="knowledge-empty">{t('knowledge.emptyKnowledge')}</div>}
            {visibleNotes.map((note) => (
              <article className="knowledge-item" key={note.id}>
                <div>
                  <strong>{note.title}</strong>
                  <time>{new Date(note.createdAt).toLocaleString(i18n.resolvedLanguage)}</time>
                </div>
                <p>{note.content}</p>
                <div className="knowledge-actions">
                  <button
                    type="button"
                    onClick={() => {
                      onReference(note)
                      setStatus(t('knowledge.referenced', { title: note.title }))
                    }}
                  >
                    <AtSign size={15} />
                    {t('common.quote')}
                  </button>
                  <button type="button" onClick={() => void addMemory(note.content, { sourceNoteId: note.id, sourceMessageId: note.messageId })}>
                    <Brain size={15} />
                    {t('knowledge.remember')}
                  </button>
                  <button type="button" onClick={() => void onCopy(note.content)}>
                    <Copy size={15} />
                    {t('common.copy')}
                  </button>
                  <button type="button" onClick={() => void onDelete(note.id)}>
                    <Trash2 size={15} />
                    {t('common.delete')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <>
            <div className="memory-form">
              <textarea
                placeholder={t('knowledge.memoryPlaceholder')}
                value={memoryDraft}
                onChange={(event) => setMemoryDraft(event.target.value)}
                rows={3}
              />
              <button className="primary-action" type="button" onClick={() => void addMemory(memoryDraft)}>
                <Plus size={16} />
                {t('knowledge.addMemory')}
              </button>
            </div>

            <div className="knowledge-list">
              {visibleMemories.length === 0 && <div className="knowledge-empty">{t('knowledge.emptyMemory')}</div>}
              {visibleMemories.map((memory) => (
                <article className={`memory-item ${memory.enabled ? 'enabled' : ''}`} key={memory.id}>
                  <div>
                    <strong>{memory.enabled ? t('common.enabled') : t('common.disabled')}</strong>
                    <time>{new Date(memory.updatedAt).toLocaleString(i18n.resolvedLanguage)}</time>
                  </div>
                  <p>{memory.content}</p>
                  <div className="knowledge-actions">
                    <button type="button" onClick={() => void toggleMemory(memory)}>
                      <CircleCheck size={15} />
                      {memory.enabled ? t('knowledge.disable') : t('knowledge.enable')}
                    </button>
                    <button type="button" onClick={() => void onCopy(memory.content)}>
                      <Copy size={15} />
                      {t('common.copy')}
                    </button>
                    <button type="button" onClick={() => void removeMemory(memory)}>
                      <Trash2 size={15} />
                      {t('common.delete')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {status && <div className="assistant-status">{status}</div>}
      </section>
    </ModalBackdrop>
  )
}

function ToolConfigDialog({
  tools,
  onClose,
  onDelete,
  onSave
}: {
  tools: ToolConfig[]
  onClose: () => void
  onDelete: (id: string) => Promise<void>
  onSave: (tool: ToolConfig) => Promise<ToolConfig>
}) {
  const { t } = useTranslation()
  const [type, setType] = useState<ToolConfigType>('function')
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveNewTool() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setStatus(t('tools.nameRequired'))
      return
    }

    setSaving(true)
    setStatus(t('tools.saving'))
    const now = Date.now()

    try {
      const saved = await onSave({
        id: createId('tool'),
        type,
        name: trimmedName,
        endpoint: endpoint.trim() || undefined,
        description: description.trim() || undefined,
        enabled: true,
        createdAt: now,
        updatedAt: now
      })
      setStatus(t('tools.saved', { tool: saved.name }))
      setName('')
      setEndpoint('')
      setDescription('')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function toggleTool(tool: ToolConfig) {
    setSaving(true)
    try {
      const saved = await onSave({ ...tool, enabled: !tool.enabled, updatedAt: Date.now() })
      setStatus(saved.enabled ? t('tools.enabled', { tool: saved.name }) : t('tools.disabled', { tool: saved.name }))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  async function removeTool(tool: ToolConfig) {
    setSaving(true)
    try {
      await onDelete(tool.id)
      setStatus(t('tools.deleted', { tool: tool.name }))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <section className="tool-center-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>G-LLM</p>
            <h2>{t('tools.title')}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        <div className="tool-center-note">
          {t('tools.note')}
        </div>

        <div className="tool-config-form">
          <div className="tool-type-tabs">
            {(['function', 'mcp', 'plugin'] as ToolConfigType[]).map((item) => (
              <button key={item} className={item === type ? 'active' : ''} onClick={() => setType(item)} type="button">
                {t(`tools.types.${item}`)}
              </button>
            ))}
          </div>
          <label>
            <span>{t('tools.name')}</span>
            <input
              placeholder={t(`tools.namePlaceholders.${type}`)}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>{t(`tools.endpointLabels.${type}`)}</span>
            <input
              placeholder={t(`tools.endpointPlaceholders.${type}`)}
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          </label>
          <label>
            <span>{t('tools.description')}</span>
            <textarea
              placeholder={t('tools.descriptionPlaceholder')}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </label>
          <button className="primary-action" disabled={saving} onClick={() => void saveNewTool()} type="button">
            <Plus size={16} />
            {t('tools.add')}
          </button>
        </div>

        <div className="tool-card-list">
          {tools.length === 0 && <div className="tool-empty">{t('tools.empty')}</div>}
          {tools.map((tool) => (
            <article key={tool.id} className={`tool-card ${tool.enabled ? 'enabled' : ''}`}>
              <span className="tool-card-icon">
                {tool.type === 'mcp' ? <Plug size={18} /> : tool.type === 'plugin' ? <Wrench size={18} /> : <Code2 size={18} />}
              </span>
              <div>
                <strong>{tool.name}</strong>
                <p>{t(`tools.types.${tool.type}`)}{tool.endpoint ? ` · ${tool.endpoint}` : ''}</p>
                {tool.description && <em>{tool.description}</em>}
              </div>
              <div className="tool-card-actions">
                <button disabled={saving} type="button" onClick={() => void toggleTool(tool)}>
                  {tool.enabled ? t('knowledge.disable') : t('knowledge.enable')}
                </button>
                <button disabled={saving} type="button" onClick={() => void removeTool(tool)}>
                  {t('common.delete')}
                </button>
              </div>
            </article>
          ))}
        </div>

        {status && <div className="assistant-status">{status}</div>}
      </section>
    </ModalBackdrop>
  )
}

function ParameterToggle({
  children,
  description,
  enabled,
  label,
  valueLabel,
  onEnabledChange
}: {
  children: ReactNode
  description: string
  enabled: boolean
  label: string
  valueLabel: string
  onEnabledChange: (enabled: boolean) => void
}) {
  return (
    <div className={`parameter-card ${enabled ? 'enabled' : ''}`}>
      <div className="parameter-card-head">
        <div>
          <strong>{label}</strong>
          <small>{description}</small>
        </div>
        <div className="parameter-actions">
          <span>{valueLabel}</span>
          <input checked={enabled} type="checkbox" onChange={(event) => onEnabledChange(event.target.checked)} />
        </div>
      </div>
      {enabled && <div className="parameter-control">{children}</div>}
    </div>
  )
}

function AddProviderDialog({
  onClose,
  onCreate
}: {
  onClose: () => void
  onCreate: (provider: ApiProvider) => Promise<void>
}) {
  const { t } = useTranslation()
  const [selectedTemplateId, setSelectedTemplateId] = useState<ProviderTemplateId>('openai-compatible')
  const [draft, setDraft] = useState(() => ({
    ...createProviderFromTemplate('openai-compatible'),
    name: t('provider.templates.openai-compatible.name')
  }))
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const selectedTemplate = PROVIDER_TEMPLATES.find((template) => template.id === selectedTemplateId) ?? PROVIDER_TEMPLATES[0]
  const normalizedQuery = query.trim().toLowerCase()
  const modelOptions = getModelOptions(draft)

  function matchesTemplate(template: (typeof PROVIDER_TEMPLATES)[number]) {
    if (!normalizedQuery) return true
    return [
      template.name,
      template.description,
      t(`provider.templates.${template.id}.name`),
      t(`provider.templates.${template.id}.description`),
      template.id,
      t(`provider.categories.${template.category}`)
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedQuery)
  }

  function selectTemplate(templateId: ProviderTemplateId) {
    const provider = {
      ...createProviderFromTemplate(templateId),
      name: t(`provider.templates.${templateId}.name`)
    }
    setSelectedTemplateId(templateId)
    setDraft(provider)
    setStatus('')
  }

  async function addProvider() {
    setSaving(true)
    setStatus(t('provider.adding'))

    try {
      await onCreate(draft)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
      setSaving(false)
    }
  }

  const hasVisibleTemplates = PROVIDER_TEMPLATES.some(matchesTemplate)

  return (
    <ModalBackdrop className="provider-add-backdrop" onClose={onClose}>
      <section className="provider-add-modal" onClick={stopModalClick}>
        <header>
          <div>
            <p>G-LLM</p>
            <h2>{t('provider.addDialogTitle')}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title={t('common.close')} type="button">
            <X size={18} />
          </button>
        </header>

        <div className="provider-add-grid">
          <aside className="provider-template-panel">
            <label className="provider-template-search">
              <Search size={17} />
              <input
                autoFocus
                placeholder={t('provider.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="provider-template-scroll">
              {!hasVisibleTemplates && <div className="provider-template-empty">{t('provider.noTemplates')}</div>}
              {providerTemplateCategoryOrder.map((category) => {
                const templates = PROVIDER_TEMPLATES.filter((template) => template.category === category && matchesTemplate(template))
                if (templates.length === 0) return null

                return (
                  <div className="template-group" key={category}>
                    <span>{t(`provider.categories.${category}`)}</span>
                    <div className="provider-template-list">
                      {templates.map((template) => (
                        <button
                          className={template.id === selectedTemplateId ? 'active' : ''}
                          key={template.id}
                          onClick={() => selectTemplate(template.id)}
                          type="button"
                        >
                          <Plug size={16} />
                          <span>
                            <strong>{t(`provider.templates.${template.id}.name`)}</strong>
                            <small>{t(`provider.templates.${template.id}.description`)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          <div className="provider-add-form">
            <div className="provider-add-summary">
              <Plug size={18} />
              <span>
                <strong>{t(`provider.templates.${selectedTemplate.id}.name`)}</strong>
                <small>{t(`provider.templates.${selectedTemplate.id}.description`)}</small>
              </span>
            </div>

            <label>
              <span>{t('provider.name')}</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>

            <label>
              <span>API Base URL</span>
              <input
                value={draft.apiBaseUrl}
                onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })}
              />
            </label>

            <label>
              <span>API Key</span>
              <input
                placeholder={draft.requiresApiKey ? t('provider.enterApiKeyLater') : t('provider.localKeyOptional')}
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </label>

            <label>
              <span>{t('provider.globalDefaultModel')}</span>
              <select value={draft.defaultModel} onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })}>
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {getModelDisplayLabel(model)}
                  </option>
                ))}
              </select>
            </label>

            <label className="switch-row provider-add-switch">
              <span>{t('provider.requiresApiKey')}</span>
              <input
                checked={draft.requiresApiKey}
                type="checkbox"
                onChange={(event) => setDraft({ ...draft, requiresApiKey: event.target.checked })}
              />
            </label>

            <div className="provider-add-note">{t('provider.addNote')}</div>
            {status && <div className="provider-status">{status}</div>}

            <div className="form-actions">
              <button className="secondary-action" disabled={saving} onClick={onClose} type="button">
                {t('common.cancel')}
              </button>
              <button className="primary-action" disabled={saving} onClick={() => void addProvider()} type="button">
                <Plus size={17} />
                {t('provider.addProvider')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </ModalBackdrop>
  )
}

function SettingsPanel({
  appVersion,
  appBuildCode,
  initialTab,
  dataLocation,
  settings,
  providers,
  goldThemeEntitled,
  goldThemeEntitlementChecked,
  onClose,
  onSaveSettings,
  onSaveProvider,
  onCheckProvider,
  onCheckThemeEntitlement,
  onRefreshProviderModels,
  onDeleteProvider,
  onDataLocationChange
}: {
  appVersion: string
  appBuildCode: string
  initialTab: SettingsTab
  dataLocation: DataLocationInfo | null
  settings: AppSettings
  providers: ApiProvider[]
  goldThemeEntitled: boolean
  goldThemeEntitlementChecked: boolean
  onClose: () => void
  onSaveSettings: (settings: AppSettings) => Promise<AppSettings>
  onSaveProvider: (provider: ApiProvider) => Promise<ApiProvider>
  onCheckProvider: (provider: ApiProvider) => Promise<ProviderCheckResult>
  onCheckThemeEntitlement: () => Promise<ThemeEntitlementResult>
  onRefreshProviderModels: (provider: ApiProvider) => Promise<ApiProvider>
  onDeleteProvider: (id: string) => Promise<void>
  onDataLocationChange: (info: DataLocationInfo) => void
}) {
  const { t, i18n } = useTranslation()
  const [settingsDraft, setSettingsDraft] = useState(settings)
  const [providerDraft, setProviderDraft] = useState(() => getProviderById(settings.activeProviderId, providers))
  const [providerStatus, setProviderStatus] = useState('')
  const [dataLocationInfo, setDataLocationInfo] = useState<DataLocationInfo | null>(dataLocation)
  const [dataLocationStatus, setDataLocationStatus] = useState('')
  const [newModelId, setNewModelId] = useState('')
  const [addProviderOpen, setAddProviderOpen] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isCheckingThemeEntitlement, setIsCheckingThemeEntitlement] = useState(false)
  const [themeEntitlementStatus, setThemeEntitlementStatus] = useState('')
  const [isChangingDataLocation, setIsChangingDataLocation] = useState(false)
  const [isArchivingData, setIsArchivingData] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null)
  const [dataArchiveNeedsRestart, setDataArchiveNeedsRestart] = useState(false)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>(initialTab)
  const providerNeedsKey = providerDraft.requiresApiKey && !providerDraft.apiKey.trim()
  const modelOptions = getModelOptions(providerDraft)
  const providerSaved = providers.some((provider) => provider.id === providerDraft.id)
  const savedProvider = providers.find((provider) => provider.id === providerDraft.id) ?? null
  const visibleProviders = providerSaved ? providers : [providerDraft, ...providers]
  const defaultModelLabel = providerDraft.defaultModel || t('common.notSet')
  const settingsChanged =
    JSON.stringify(getComparableSettings(settingsDraft)) !== JSON.stringify(getComparableSettings(settings))
  const providerChanged =
    !savedProvider ||
    JSON.stringify(getComparableProvider(providerDraft)) !== JSON.stringify(getComparableProvider(savedProvider))
  const configChanged = settingsChanged || providerChanged

  useEffect(() => {
    if (dataLocation) setDataLocationInfo(dataLocation)
  }, [dataLocation])

  useEffect(() => {
    let mounted = true
    void window.gllm.getAppUpdateState().then((status) => {
      if (!mounted) return
      setUpdateInfo(status)
      setIsCheckingUpdate(status.status === 'checking')
    })
    const unsubscribe = window.gllm.onAppUpdateStatus((status) => {
      if (!mounted) return
      setUpdateInfo(status)
      setIsCheckingUpdate(status.status === 'checking')
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    setSettingsDraft((current) =>
      current.floatingMascotVisible === settings.floatingMascotVisible
        ? current
        : { ...current, floatingMascotVisible: settings.floatingMascotVisible }
    )
  }, [settings.floatingMascotVisible])

  useEffect(() => {
    if (!dataLocationInfo) {
      void window.gllm.getDataLocation().then((info) => {
        setDataLocationInfo(info)
        onDataLocationChange(info)
      })
    }
  }, [dataLocationInfo, onDataLocationChange])

  function selectProvider(provider: ApiProvider) {
    setProviderDraft(provider)
    setSettingsDraft({ ...settingsDraft, activeProviderId: provider.id })
    setProviderStatus('')
    setNewModelId('')
    setApiKeyVisible(false)
  }

  async function createProvider(provider: ApiProvider) {
    const savedProvider = await onSaveProvider(provider)
    setProviderDraft(savedProvider)
    setSettingsDraft({ ...settingsDraft, activeProviderId: savedProvider.id })
    setProviderStatus(t('provider.added', { provider: savedProvider.name }))
    setNewModelId('')
    setApiKeyVisible(false)
    setAddProviderOpen(false)
  }

  function setDefaultModel(modelId: string) {
    setProviderDraft({ ...providerDraft, defaultModel: modelId })
    setProviderStatus(t('provider.defaultSelected', { model: modelId }))
  }

  function addManualModel() {
    const id = newModelId.trim()
    if (!id) return

    const models = providerDraft.models.some((model) => model.id === id)
      ? providerDraft.models
      : [{ id, name: id, capabilities: inferModelCapabilities(id), type: inferModelType(id) }, ...providerDraft.models]

    setProviderDraft({
      ...providerDraft,
      models,
      defaultModel: providerDraft.defaultModel || id
    })
    setNewModelId('')
    setProviderStatus(t('provider.modelAdded', { model: id }))
  }

  function deleteModel(id: string) {
    const nextModels = providerDraft.models.filter((model) => model.id !== id)
    const nextDefaultModel =
      providerDraft.defaultModel === id ? nextModels[0]?.id || providerDraft.defaultModel : providerDraft.defaultModel

    setProviderDraft({
      ...providerDraft,
      models: nextModels,
      defaultModel: nextDefaultModel
    })
    setProviderStatus(t('provider.modelRemoved', { model: id }))
  }

  async function saveAll() {
    if (!configChanged) return

    const savedProvider = await onSaveProvider(providerDraft)
    const savedSettings = await onSaveSettings({
      ...settingsDraft,
      activeProviderId: savedProvider.id,
      setupCompleted: true
    })
    setProviderDraft(savedProvider)
    setSettingsDraft(savedSettings)
    onClose()
  }

  async function deleteCurrentProvider() {
    if (providerDraft.id === DEFAULT_PROVIDER_ID) return
    const confirmed = window.confirm(t('provider.confirmDelete', { provider: providerDraft.name }))
    if (!confirmed) return

    await onDeleteProvider(providerDraft.id)
    const nextProvider = getProviderById(DEFAULT_PROVIDER_ID, providers)
    setProviderDraft(nextProvider)
    setSettingsDraft({ ...settingsDraft, activeProviderId: DEFAULT_PROVIDER_ID })
    setProviderStatus('')
  }

  async function testConnection() {
    setIsChecking(true)
    setProviderStatus(t('provider.testing'))
    const result = await onCheckProvider(providerDraft)
    setProviderStatus(result.message)
    if (result.ok && result.models?.length) {
      setProviderDraft({
        ...providerDraft,
        models: result.models,
        defaultModel: providerDraft.defaultModel || result.models[0].id,
        modelsUpdatedAt: Date.now()
      })
    }
    setIsChecking(false)
  }

  async function selectGoldTheme() {
    if (isCheckingThemeEntitlement) return

    setIsCheckingThemeEntitlement(true)
    setThemeEntitlementStatus('')
    try {
      const entitlement = await onCheckThemeEntitlement()
      setThemeEntitlementStatus(entitlement.message)
      if (entitlement.eligible) {
        setSettingsDraft((current) => ({ ...current, theme: 'gold' }))
      }
    } catch (error) {
      setThemeEntitlementStatus(error instanceof Error ? error.message : t('provider.goldCheckFailed'))
    } finally {
      setIsCheckingThemeEntitlement(false)
    }
  }

  async function refreshModels() {
    setIsRefreshing(true)
    setProviderStatus(t('provider.fetching'))
    try {
      const saved = await onRefreshProviderModels(providerDraft)
      setProviderDraft(saved)
      setSettingsDraft({ ...settingsDraft, activeProviderId: saved.id })
      setProviderStatus(t('provider.fetched', { count: saved.models.length }))
    } catch (error) {
      setProviderStatus(error instanceof Error ? error.message : String(error))
    }
    setIsRefreshing(false)
  }

  async function openDataDirectory() {
    setDataLocationStatus('')
    try {
      await window.gllm.openDataDirectory()
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function openLogDirectory() {
    setDataLocationStatus('')
    try {
      await window.gllm.openLogDirectory()
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function exportDiagnostics() {
    setDataLocationStatus('')
    try {
      const path = await window.gllm.exportDiagnostics()
      setDataLocationStatus(path
        ? t('storage.diagnosticsExported', { path })
        : t('storage.diagnosticsExportCancelled'))
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    }
  }

  async function chooseDataDirectory() {
    const confirmed = window.confirm(t('storage.confirmChoose'))
    if (!confirmed) return

    setIsChangingDataLocation(true)
    setDataLocationStatus(t('storage.choosing'))
    try {
      const result = await window.gllm.chooseDataDirectory()
      if (!result) {
        setDataLocationStatus(t('storage.chooseCancelled'))
        return
      }

      setDataLocationInfo(result.info)
      onDataLocationChange(result.info)
      setDataLocationStatus(result.message)
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChangingDataLocation(false)
    }
  }

  async function resetDataDirectory() {
    const confirmed = window.confirm(t('storage.confirmReset'))
    if (!confirmed) return

    setIsChangingDataLocation(true)
    setDataLocationStatus(t('storage.resetting'))
    try {
      const result = await window.gllm.resetDataDirectory()
      setDataLocationInfo(result.info)
      onDataLocationChange(result.info)
      setDataLocationStatus(result.message)
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsChangingDataLocation(false)
    }
  }

  async function exportDataArchive() {
    setIsArchivingData(true)
    setDataLocationStatus(t('storage.exporting'))
    try {
      const result = await window.gllm.exportDataArchive()
      if (!result) {
        setDataLocationStatus(t('storage.exportCancelled'))
        return
      }

      setDataLocationStatus(result.message)
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsArchivingData(false)
    }
  }

  async function importDataArchive() {
    const confirmed = window.confirm(t('storage.confirmImport'))
    if (!confirmed) return

    setIsArchivingData(true)
    setDataLocationStatus(t('storage.importing'))
    try {
      const result = await window.gllm.importDataArchive()
      if (!result) {
        setDataLocationStatus(t('storage.importCancelled'))
        return
      }

      setDataArchiveNeedsRestart(Boolean(result.restartRequired))
      setDataLocationStatus(
        result.backupPath ? t('storage.importBackup', { message: result.message, path: result.backupPath }) : result.message
      )
    } catch (error) {
      setDataLocationStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setIsArchivingData(false)
    }
  }

  async function relaunchApp() {
    await window.gllm.relaunchApp()
  }

  async function checkForUpdates() {
    setIsCheckingUpdate(true)
    setUpdateInfo(null)
    try {
      setUpdateInfo(await window.gllm.checkForUpdates())
    } catch (error) {
      setUpdateInfo({
        currentVersion: appVersion,
        updateAvailable: false,
        status: 'unavailable',
        automaticUpdateSupported: false,
        downloadPageUrl: 'https://llm.gprophet.com/download',
        message: error instanceof Error ? error.message : t('about.updateCheckFailed')
      })
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  async function downloadUpdate() {
    try {
      setUpdateInfo(await window.gllm.downloadAppUpdate())
    } catch (error) {
      setUpdateInfo({
        currentVersion: appVersion,
        updateAvailable: true,
        status: 'error',
        automaticUpdateSupported: true,
        downloadPageUrl: 'https://llm.gprophet.com/download',
        message: error instanceof Error ? error.message : t('about.updateCheckFailed')
      })
    }
  }

  async function installUpdate() {
    const installing = await window.gllm.installAppUpdate()
    if (!installing) setUpdateInfo(await window.gllm.getAppUpdateState())
  }

  async function openDownloadPage() {
    await window.gllm.openDownloadPage()
  }

  async function openLegalDocument(document: LegalDocument) {
    try {
      await window.gllm.openLegalDocument(document)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t('about.legalOpenFailed'))
    }
  }

  const isWindows = window.gllm.platform === 'win32'

  async function quitApp() {
    const confirmed = window.confirm(t('about.confirmQuit'))
    if (!confirmed) return

    await window.gllm.quitApp()
  }

  return (
    <ModalBackdrop className="drawer-backdrop" onClose={onClose}>
      <section className="settings-drawer provider-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="settings-tabs-row">
          <div className="settings-tabs" role="tablist" aria-label={t('settings.tabsLabel')}>
            {settingsTabs.map((tab) => (
              <button
                aria-selected={activeSettingsTab === tab}
                className={activeSettingsTab === tab ? 'active' : ''}
                key={tab}
                onClick={() => setActiveSettingsTab(tab)}
                role="tab"
                type="button"
              >
                {t(`settings.tabs.${tab}`)}
              </button>
            ))}
          </div>
        </div>

        {activeSettingsTab === 'providers' && providerNeedsKey && (
          <div className="setup-warning">
            <KeyRound size={18} />
            <span>{t('provider.apiKeyIntro')}</span>
          </div>
        )}

        {activeSettingsTab === 'providers' && (
          <div className="provider-manager">
            <div className="provider-sidebar">
              <div className="provider-list">
                <div className="provider-list-head">
                  <div className="provider-list-title">
                    <strong>{t('provider.providers')}</strong>
                    <button onClick={() => setAddProviderOpen(true)} type="button">
                      <Plus size={15} />
                      {t('provider.add')}
                    </button>
                  </div>
                  <small>{t('provider.globalHint')}</small>
                </div>
                {visibleProviders.map((provider) => {
                  const isActiveProvider = provider.id === providerDraft.id
                  const displayProvider = isActiveProvider ? providerDraft : provider

                  return (
                    <button
                      key={provider.id}
                      className={`provider-item ${isActiveProvider ? 'active' : ''}`}
                      onClick={() => selectProvider(displayProvider)}
                    >
                      <Plug size={17} />
                      <span>
                        <strong>{displayProvider.name}{isActiveProvider && !providerSaved ? ` (${t('provider.unsaved')})` : ''}</strong>
                        <small>{displayProvider.apiBaseUrl}</small>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="provider-form">
              <div className="form-row two provider-default-model-row">
                <label>
                  <span>{t('provider.name')}</span>
                  <input
                    value={providerDraft.name}
                    onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}
                  />
                </label>
                <div className="settings-model-field">
                  <span>{t('provider.globalDefaultModel')}</span>
                  <ModelPickerMenu
                    provider={providerDraft}
                    value={providerDraft.defaultModel}
                    variant="dropdown"
                    onChange={setDefaultModel}
                  />
                </div>
              </div>

              <label>
                <span>API Base URL</span>
                <input
                  value={providerDraft.apiBaseUrl}
                  onChange={(event) => setProviderDraft({ ...providerDraft, apiBaseUrl: event.target.value })}
                />
              </label>

              <label>
                <span>API Key</span>
                <div className="secret-input-row">
                  <input
                    placeholder={providerDraft.requiresApiKey ? t('provider.enterApiKey') : t('provider.localKeyOptional')}
                    type={apiKeyVisible ? 'text' : 'password'}
                    value={providerDraft.apiKey}
                    onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })}
                  />
                  <button
                    aria-label={apiKeyVisible ? t('provider.hideApiKey') : t('provider.showApiKey')}
                    aria-pressed={apiKeyVisible}
                    className="secret-toggle-button"
                    onClick={() => setApiKeyVisible((visible) => !visible)}
                    title={apiKeyVisible ? t('provider.hideApiKey') : t('provider.showApiKey')}
                    type="button"
                  >
                    {apiKeyVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </label>

              <label className="switch-row">
                <span>{t('provider.requiresApiKey')}</span>
                <input
                  checked={providerDraft.requiresApiKey}
                  type="checkbox"
                  onChange={(event) => setProviderDraft({ ...providerDraft, requiresApiKey: event.target.checked })}
                />
              </label>

              <div className="provider-tools">
                <button disabled={isChecking} onClick={testConnection} type="button">
                  <CircleCheck size={16} />
                  {t('provider.testConnection')}
                </button>
                <button disabled={isRefreshing} onClick={refreshModels} type="button">
                  <RefreshCw size={16} />
                  {t('provider.fetchModels')}
                </button>
                {providerDraft.modelsUpdatedAt && <span>{new Date(providerDraft.modelsUpdatedAt).toLocaleString(i18n.resolvedLanguage)}</span>}
              </div>

              {providerStatus && <div className="provider-status">{providerStatus}</div>}

              <section className="model-manager">
                <div className="default-model-card">
                  <span>{t('provider.currentDefaultModel')}</span>
                  <strong>{defaultModelLabel}</strong>
                  <small>{t('provider.defaultModelHint')}</small>
                </div>
                <div className="model-manager-head">
                  <div>
                    <strong>{t('provider.modelManager')}</strong>
                    <small>{t('provider.capabilitiesHint')}</small>
                  </div>
                </div>
                <div className="model-chip-list">
                  {modelOptions.map((model) => (
                    <div
                      key={model.id}
                      className={model.id === providerDraft.defaultModel ? 'active' : ''}
                    >
                      <button className="model-name-button" onClick={() => setDefaultModel(model.id)} type="button">
                        <span>{model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id}</span>
                        {model.id === providerDraft.defaultModel && <small>{t('provider.defaultBadge')}</small>}
                      </button>
                      <span className="model-capability-list">
                        {normalizeModelCapabilities(model).map((capability) => (
                          <span key={capability} className={`model-capability-badge type-${capability}`}>
                            {t(`modelPicker.capability.${capability}`)}
                          </span>
                        ))}
                      </span>
                      {model.id !== providerDraft.defaultModel && (
                        <button className="model-delete-button" onClick={() => deleteModel(model.id)} title={t('provider.deleteModel')} type="button">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="model-add-fallback">
                  <div>
                    <strong>{t('provider.manualAdd')}</strong>
                    <small>{t('provider.manualAddHint')}</small>
                  </div>
                  <div className="model-add-row">
                    <input
                      placeholder={t('provider.modelIdPlaceholder')}
                      value={newModelId}
                      onChange={(event) => setNewModelId(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          addManualModel()
                        }
                      }}
                    />
                    <button onClick={addManualModel} type="button">
                      <Plus size={16} />
                      {t('provider.addModel')}
                    </button>
                  </div>
                </div>
              </section>

              <section className="parameter-section">
                <ParameterToggle
                  description={t('provider.temperatureHint')}
                  enabled={settingsDraft.enableTemperature}
                  label={t('provider.temperature')}
                  valueLabel={settingsDraft.enableTemperature ? settingsDraft.temperature.toFixed(1) : t('common.defaultValue')}
                  onEnabledChange={(enabled) => setSettingsDraft({ ...settingsDraft, enableTemperature: enabled })}
                >
                  <div className="temperature-control">
                    <input
                      max={2}
                      min={0}
                      step={0.1}
                      type="range"
                      value={settingsDraft.temperature}
                      onChange={(event) =>
                        setSettingsDraft({ ...settingsDraft, temperature: Number(event.target.value) })
                      }
                    />
                    <div className="range-marks">
                      <span>{t('provider.precise')}</span>
                      <span>1</span>
                      <span>{t('provider.creative')}</span>
                    </div>
                  </div>
                </ParameterToggle>

                <ParameterToggle
                  description={t('provider.maxTokensHint')}
                  enabled={settingsDraft.enableMaxTokens}
                  label={t('provider.maxTokens')}
                  valueLabel={settingsDraft.enableMaxTokens ? settingsDraft.maxTokens.toLocaleString(i18n.resolvedLanguage) : t('common.defaultValue')}
                  onEnabledChange={(enabled) => setSettingsDraft({ ...settingsDraft, enableMaxTokens: enabled })}
                >
                  <input
                    min={1}
                    step={1}
                    type="number"
                    value={settingsDraft.maxTokens}
                    onChange={(event) => setSettingsDraft({ ...settingsDraft, maxTokens: Number(event.target.value) })}
                  />
                </ParameterToggle>
              </section>

              <div className="form-actions provider-form-actions">
                <div className="provider-footer-actions">
                  <button
                    className="danger-action"
                    disabled={providerDraft.id === DEFAULT_PROVIDER_ID}
                    onClick={deleteCurrentProvider}
                    type="button"
                  >
                    <Trash2 size={17} />
                    {t('provider.deleteProvider')}
                  </button>
                  <button className="secondary-action" onClick={onClose} type="button">
                    <X size={17} />
                    {t('settings.closeWithoutSaving')}
                  </button>
                  <button className="primary-action" disabled={!configChanged} onClick={saveAll} type="button">
                    <Save size={17} />
                    {t('settings.saveConfiguration')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSettingsTab === 'personalization' && (
          <div className="settings-tab-panel personalization-settings-panel">
            <section className="preference-section language-preference-section">
              <div className="data-location-head">
                <div>
                  <strong>{t('language.label')}</strong>
                  <small>{t('language.description')}</small>
                </div>
              </div>
              <select
                className="language-select"
                value={settingsDraft.language}
                onChange={(event) => {
                  const language = event.target.value as AppSettings['language']
                  setSettingsDraft({ ...settingsDraft, language })
                }}
              >
                <option value="system">{t('language.system')}</option>
                <option value="zh-CN">{t('language.zhCN')}</option>
                <option value="en-US">{t('language.enUS')}</option>
              </select>
            </section>

            <section className="preference-section timezone-preference-section">
              <div className="data-location-head">
                <div>
                  <strong>{t('settings.timeZone.title')}</strong>
                  <small>{t('settings.timeZone.description')}</small>
                </div>
              </div>
              <select
                className="language-select"
                value={settingsDraft.timeZone}
                onChange={(event) => setSettingsDraft({ ...settingsDraft, timeZone: event.target.value })}
              >
                <option value="system">
                  {t('settings.timeZone.system', { zone: resolveTimeZone('system') })}
                </option>
                {TIME_ZONE_OPTIONS.map((timeZone) => (
                  <option key={timeZone} value={timeZone}>{getTimeZoneOptionLabel(timeZone)}</option>
                ))}
              </select>
            </section>

            <section className="preference-section theme-preference-section">
              <div className="data-location-head">
                <div>
                  <strong>{t('settings.theme.title')}</strong>
                  <small>{t('settings.theme.description')}</small>
                </div>
                {goldThemeEntitled && <span>{t('settings.theme.exclusive')}</span>}
              </div>

              <div className="theme-option-list">
                <label className={`theme-option ${settingsDraft.theme === 'auto' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.theme === 'auto'}
                    name="app-theme"
                    type="radio"
                    value="auto"
                    onChange={() => setSettingsDraft({ ...settingsDraft, theme: 'auto' })}
                  />
                  <span className="theme-preview auto"><MonitorCog size={19} /></span>
                  <span>
                    <strong>{t('settings.theme.auto')}</strong>
                    <small>{t('settings.theme.autoDescription')}</small>
                  </span>
                </label>

                <label className={`theme-option ${settingsDraft.theme === 'light' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.theme === 'light'}
                    name="app-theme"
                    type="radio"
                    value="light"
                    onChange={() => setSettingsDraft({ ...settingsDraft, theme: 'light' })}
                  />
                  <span className="theme-preview light"><Sun size={19} /></span>
                  <span>
                    <strong>{t('settings.theme.light')}</strong>
                    <small>{t('settings.theme.lightDescription')}</small>
                  </span>
                </label>

                <label className={`theme-option ${settingsDraft.theme === 'dark' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.theme === 'dark'}
                    name="app-theme"
                    type="radio"
                    value="dark"
                    onChange={() => setSettingsDraft({ ...settingsDraft, theme: 'dark' })}
                  />
                  <span className="theme-preview dark"><Moon size={19} /></span>
                  <span>
                    <strong>{t('settings.theme.dark')}</strong>
                    <small>{t('settings.theme.darkDescription')}</small>
                  </span>
                </label>

                <label
                  aria-disabled={goldThemeEntitlementChecked && !goldThemeEntitled}
                  className={`theme-option gold ${settingsDraft.theme === 'gold' ? 'active' : ''} ${goldThemeEntitlementChecked && !goldThemeEntitled ? 'disabled' : ''}`}
                  title={goldThemeEntitlementChecked && !goldThemeEntitled ? themeEntitlementStatus : t('settings.theme.eligibilityHint')}
                  onClick={goldThemeEntitlementChecked && !goldThemeEntitled
                    ? (event) => {
                        event.preventDefault()
                        void selectGoldTheme()
                      }
                    : undefined}
                >
                  <input
                    checked={settingsDraft.theme === 'gold'}
                    disabled={isCheckingThemeEntitlement || (goldThemeEntitlementChecked && !goldThemeEntitled)}
                    name="app-theme"
                    type="radio"
                    value="gold"
                    onChange={() => void selectGoldTheme()}
                  />
                  <span className="theme-preview gold"><Crown size={19} /></span>
                  <span>
                    <strong>{t('settings.theme.gold')}</strong>
                    <small>{goldThemeEntitlementChecked && !goldThemeEntitled ? t('settings.theme.eligibilityRequired') : t('settings.theme.goldDescription')}</small>
                  </span>
                </label>
              </div>
              {(isCheckingThemeEntitlement || themeEntitlementStatus) && (
                <small className="theme-entitlement-status">
                  {isCheckingThemeEntitlement ? t('settings.theme.checkingEligibility') : themeEntitlementStatus}
                </small>
              )}
            </section>

            <section className="preference-section">
              <div className="data-location-head">
                <div>
                  <strong>{t('settings.sendShortcut.title')}</strong>
                  <small>{t('settings.sendShortcut.description')}</small>
                </div>
                <span>{getMessageSendShortcutLabel(settingsDraft.messageSendShortcut)}</span>
              </div>

              <div className="shortcut-option-list">
                <label className={`shortcut-option ${settingsDraft.messageSendShortcut === 'enter' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.messageSendShortcut === 'enter'}
                    name="message-send-shortcut"
                    type="radio"
                    value="enter"
                    onChange={() => setSettingsDraft({ ...settingsDraft, messageSendShortcut: 'enter' })}
                  />
                  <span>
                    <strong>{t('settings.sendShortcut.enter')}</strong>
                    <small>{t('settings.sendShortcut.enterDescription')}</small>
                  </span>
                </label>

                <label className={`shortcut-option ${settingsDraft.messageSendShortcut === 'ctrl-enter' ? 'active' : ''}`}>
                  <input
                    checked={settingsDraft.messageSendShortcut === 'ctrl-enter'}
                    name="message-send-shortcut"
                    type="radio"
                    value="ctrl-enter"
                    onChange={() => setSettingsDraft({ ...settingsDraft, messageSendShortcut: 'ctrl-enter' })}
                  />
                  <span>
                    <strong>{t('settings.sendShortcut.ctrlEnter')}</strong>
                    <small>{t('settings.sendShortcut.ctrlEnterDescription')}</small>
                  </span>
                </label>
              </div>
            </section>

            <div className="form-actions settings-panel-actions">
              <button className="secondary-action" onClick={onClose} type="button">
                <X size={17} />
                {t('settings.closeWithoutSaving')}
              </button>
              <button className="primary-action" disabled={!configChanged} onClick={saveAll} type="button">
                <Save size={17} />
                {t('settings.saveConfiguration')}
              </button>
            </div>
          </div>
        )}

        {activeSettingsTab === 'storage' && (
          <div className="settings-tab-panel storage-settings-panel">
            <section className="data-location-section">
              <div className="data-location-head">
                <div>
                  <strong>{t('storage.title')}</strong>
                  <small>{t('storage.description')}</small>
                </div>
                <span>{dataLocationInfo?.mode === 'portable' ? t('storage.portable') : t('storage.standard')}</span>
              </div>

              {dataLocationInfo ? (
                <div className="data-location-card">
                  <Database size={19} />
                  <div className="data-location-content">
                    <div className="data-location-row">
                      <span>{t('storage.currentDirectory')}</span>
                      <strong title={dataLocationInfo.effectivePath}>{dataLocationInfo.effectivePath}</strong>
                    </div>
                    <div className="data-location-row">
                      <span>{t('storage.defaultDirectory')}</span>
                      <strong title={dataLocationInfo.defaultPath}>{dataLocationInfo.defaultPath}</strong>
                    </div>
                    {dataLocationInfo.customPath && (
                      <div className="data-location-row">
                        <span>{t('storage.customDirectory')}</span>
                        <strong title={dataLocationInfo.customPath}>{dataLocationInfo.customPath}</strong>
                      </div>
                    )}
                    {dataLocationInfo.pendingRestart && (
                      <div className="data-location-pending">
                        <span>{t('storage.pending')}</span>
                        <strong>{t('storage.pendingDescription')}</strong>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="data-location-card loading">{t('storage.loading')}</div>
              )}

              <div className="data-location-actions">
                <button onClick={openDataDirectory} type="button">
                  <FolderOpen size={15} />
                  {t('storage.openDirectory')}
                </button>
                <button onClick={openLogDirectory} type="button">
                  <FileText size={15} />
                  {t('storage.openLogs')}
                </button>
                <button onClick={exportDiagnostics} type="button">
                  <Download size={15} />
                  {t('storage.exportDiagnostics')}
                </button>
                <button disabled={isChangingDataLocation} onClick={chooseDataDirectory} type="button">
                  <Database size={15} />
                  {t('storage.changeDirectory')}
                </button>
                <button disabled={isChangingDataLocation || !dataLocationInfo?.isCustom} onClick={resetDataDirectory} type="button">
                  <RotateCcw size={15} />
                  {t('storage.restoreDefault')}
                </button>
                <button disabled={!(dataLocationInfo?.pendingRestart || dataArchiveNeedsRestart)} onClick={relaunchApp} type="button">
                  <Power size={15} />
                  {t('storage.restartToApply')}
                </button>
              </div>
              {dataLocationStatus && <p>{dataLocationStatus}</p>}
            </section>

            <section className="data-archive-section">
              <div className="data-location-head">
                <div>
                  <strong>{t('storage.archiveTitle')}</strong>
                  <small>{t('storage.archiveDescription')}</small>
                </div>
                <span>ZIP</span>
              </div>
              <div className="data-archive-actions">
                <button disabled={isArchivingData} onClick={exportDataArchive} type="button">
                  <Download size={16} />
                  {t('storage.export')}
                </button>
                <button disabled={isArchivingData} onClick={importDataArchive} type="button">
                  <Upload size={16} />
                  {t('storage.import')}
                </button>
              </div>
            </section>

            <div className="form-actions settings-panel-actions">
              <button className="secondary-action" onClick={onClose} type="button">
                <X size={17} />
                {t('settings.closeWithoutSaving')}
              </button>
              <button className="primary-action" disabled={!configChanged} onClick={saveAll} type="button">
                <Save size={17} />
                {t('settings.saveConfiguration')}
              </button>
            </div>
          </div>
        )}

        {activeSettingsTab === 'about' && (
          <div className="settings-tab-panel about-settings-panel">
            <section className="about-system-section">
              <div className="about-system-card">
                <img alt="G-LLM" src={logo} />
                <div>
                  <strong>{t('about.productName')}</strong>
                  <span>{t('about.tagline')}</span>
                </div>
              </div>
              <p>{t('about.description')}</p>
              <div className="about-system-meta">
                <div>
                  <span>{t('about.version')}</span>
                  <strong>V{appVersion}{appBuildCode ? `(${appBuildCode})` : ''}</strong>
                </div>
                <div className="about-update-actions">
                  <button
                    className="about-release-link"
                    disabled={isCheckingUpdate}
                    onClick={() => void checkForUpdates()}
                    type="button"
                  >
                    <RefreshCw className={isCheckingUpdate ? 'spin' : ''} size={15} />
                    {isCheckingUpdate ? t('about.checking') : t('about.checkUpdates')}
                  </button>
                  <button className="about-release-link" onClick={() => void openDownloadPage()} type="button">
                    <ExternalLink size={15} />
                    {t('about.downloadAndChangelog')}
                  </button>
                </div>
              </div>
              {updateInfo && (
                <div className={`about-update-result ${updateInfo.status}`} role="status">
                  <strong>{updateInfo.message}</strong>
                  <small>
                    {updateInfo.automaticUpdateSupported ? t('about.automaticUpdates') : t('about.manualUpdateOnly')}
                  </small>
                  {updateInfo.updatedAt && <small>{t('about.releaseDate', { date: updateInfo.updatedAt })}</small>}
                  {updateInfo.releaseNotes && <p>{updateInfo.releaseNotes}</p>}
                  {updateInfo.status === 'downloading' && (
                    <progress max={100} value={updateInfo.downloadProgress ?? 0} />
                  )}
                  {updateInfo.status === 'available' && updateInfo.automaticUpdateSupported && (
                    <button onClick={() => void downloadUpdate()} type="button">
                      {t('about.downloadUpdate')}
                    </button>
                  )}
                  {updateInfo.status === 'downloading' && (
                    <button disabled type="button">
                      {t('about.downloadingUpdate', { progress: updateInfo.downloadProgress ?? 0 })}
                    </button>
                  )}
                  {updateInfo.status === 'downloaded' && (
                    <>
                      <small>{t('about.installOnQuit')}</small>
                      <button onClick={() => void installUpdate()} type="button">
                        {t('about.restartToInstall')}
                      </button>
                    </>
                  )}
                  {((updateInfo.updateAvailable && !updateInfo.automaticUpdateSupported) ||
                    updateInfo.status === 'unavailable' ||
                    updateInfo.status === 'unsupported' ||
                    updateInfo.status === 'error') && (
                    <button onClick={() => void openDownloadPage()} type="button">
                      {t('about.openDownloadPage')}
                      <ExternalLink size={14} />
                    </button>
                  )}
                </div>
              )}
              <div className="about-legal-summary">
                <div>
                  <strong>{t('about.sourceAndCommercial')}</strong>
                  <span>{t('about.licenseSummary', { version: appVersion })}</span>
                </div>
                <div className="about-legal-actions">
                  <button className="about-release-link" onClick={() => void openLegalDocument('license')} type="button">
                    <Scale size={15} />
                    {t('about.sourceLicense')}
                  </button>
                  <button className="about-release-link" onClick={() => void openLegalDocument('third-party')} type="button">
                    <BookOpen size={15} />
                    {t('about.thirdParty')}
                  </button>
                  <button className="about-release-link" onClick={() => void openLegalDocument('commercial')} type="button">
                    <Briefcase size={15} />
                    {t('about.commercialLicense')}
                  </button>
                  <button className="about-release-link" onClick={() => void openLegalDocument('trademarks')} type="button">
                    <FileText size={15} />
                    {t('about.trademarkPolicy')}
                  </button>
                </div>
              </div>
            </section>

            <section className="privacy-section">
              <label className="switch-row telemetry-switch">
                <span>
                  <strong>{t('about.telemetry')}</strong>
                  <small>{t('about.telemetryDescription')}</small>
                </span>
                <input
                  checked={settingsDraft.telemetryEnabled}
                  type="checkbox"
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, telemetryEnabled: event.target.checked })}
                />
              </label>
              <p>{t('about.telemetryDisabledDescription')}</p>
            </section>

            {isWindows && (
              <section className="app-lifecycle-section">
                <div className="data-location-head">
                  <div>
                    <strong>{t('about.lifecycle')}</strong>
                    <small>{t('about.lifecycleDescription')}</small>
                  </div>
                </div>
                <button className="danger-action app-quit-button" onClick={quitApp} type="button">
                  <Power size={16} />
                  {t('about.quit')}
                </button>
              </section>
            )}

            <div className="form-actions settings-panel-actions">
              <button className="secondary-action" onClick={onClose} type="button">
                <X size={17} />
                {t('settings.closeWithoutSaving')}
              </button>
              <button className="primary-action" disabled={!configChanged} onClick={saveAll} type="button">
                <Save size={17} />
                {t('settings.saveConfiguration')}
              </button>
            </div>
          </div>
        )}
      </section>
      {addProviderOpen && (
        <div onClick={(event) => event.stopPropagation()}>
          <AddProviderDialog
            onClose={() => setAddProviderOpen(false)}
            onCreate={(provider) => createProvider(provider)}
          />
        </div>
      )}
    </ModalBackdrop>
  )
}
