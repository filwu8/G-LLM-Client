/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import {
  ArrowDown,
  AtSign,
  BookOpen,
  Brain,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  ImagePlus,
  MessageSquarePlus,
  Minus,
  MonitorCog,
  NotebookPen,
  Paperclip,
  Pencil,
  RefreshCw,
  Send,
  Square,
  Target,
  Trash2,
  Wrench,
  X
} from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
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
import { replaceUserMessageBranch } from './conversationEditing'
import {
  applyConversationModelSelection,
  attachDraftWorkspace,
  conversationWorkspace,
  stopConversationWebSearch,
  stopPendingWebSearch
} from './conversationRuntime'
import {
  getMessageSelectionSnapshot,
  writePlainTextToClipboard,
  writeRichTextToClipboard,
  type MessageSelectionSnapshot
} from './clipboard'
import {
  flushComposerDraftPersist,
  getComposerDraftStorageKey,
  getComposerSessionKey,
  persistComposerDraft,
  QUICK_COMPOSER_DRAFT_KEY,
  readComposerDraft,
  resizeComposerTextarea,
  scheduleComposerDraftPersist
} from './composerInput'
import { getMessageSendShortcutLabel, shouldSendMessageFromKeyboard } from './keyboard'
import { applyRendererLanguage } from './i18n'
import { primeOverlayPipeline } from './overlayPrewarm'
import { ImagePreviewDialog, type ImagePreviewSource } from './ImagePreviewDialog'
import { GoalChoiceCards } from './GoalChoiceCards'
import { localizeAssistant } from './localizedContent'
import { MarkdownMessage } from './MarkdownMessage'
import { ResponseDuration } from './ResponseDuration'
import { GoalSetupDialog, GoalTaskPanel, type GoalSetupValue } from './GoalMode'
import { getModelOptions, ModelPickerMenu } from './ModelPicker'
import { applyDocumentTheme } from './theme'
import { formatMessageTimestamp } from './timeZone'
import { ModelResponseWait, WorkspaceActivityLog, WorkspaceApprovalDialog, WorkspaceBar, WorkspaceOperationApprovalDialog, WorkspaceResumeNotice } from './WorkspaceBar'
import { AgentPermissionPicker } from './AgentPermissionPicker'
import { WorkspaceInteractionDialog } from './WorkspaceInteractionDialog'
import { GllmAccountPanel, isManagedGllmProvider } from './GllmAccountPanel'
import { DesktopAccessSetupDialog, type WorkspaceAgentSettings } from './WorkspaceAgentSettings'
import { hasUnfinishedWorkspaceTask, projectWorkspace, relocateWorkspaceLocation, usesWorkspaceAgent } from '@shared/workspaceRouting'
import { droppedFileInputs } from './droppedFiles'
import { WebSearchModePicker } from './WebSearchModePicker'
import { WebSearchActivityCard } from './WebSearchActivityCard'
import { DEFAULT_ASSISTANTS, getAssistantById } from '@shared/assistants'
import { resolveAssistantSkills, resolveAssistantTools } from '@shared/assistantCapabilities'
import { getSkillInstallIntent } from '@shared/skillInstallation'
import { prepareSkillInstallationConversation, saveSkillInstallationFailure } from './conversationSkillInstallation'
import { DEFAULT_PROVIDER, getProviderById, isProviderApiKeyMissing, resolveProviderModelId } from '@shared/providers'
import { decideConversationWebSearch } from '@shared/webSearchMode'
import { WORKSPACE_ACTIVITY_HISTORY, WORKSPACE_ALREADY_RUNNING } from '@shared/goalMode'
import { estimateTokenCount } from '@shared/tokenEstimate'
import { extractChoicesFromReply } from '@shared/choiceExtraction'
import { resolveGoalContextMode, selectGoalContextMessages } from '@shared/goalContext'
import type {
  AgentPermissionMode,
  ApiProvider,
  AppSettings,
  AttachmentKind,
  Assistant,
  AssistantMemory,
  ChatChunk,
  ChatMessage,
  ComposerSessionTarget,
  Conversation,
  ConversationWorkspace,
  GoalDraft,
  GoalAssessResult,
  GoalChoice,
  GoalTask,
  KnowledgeReference,
  MessageRetryAttempt,
  PreparedAttachment,
  Project,
  ReasoningEffort,
  SkillConfig,
  ToolConfig,
  WebSearchMode,
  WorkspaceAgentRequest,
  WorkspaceApprovalPrompt,
  WorkspaceInteractionRequest,
  WorkspaceRunSnapshot,
  WorkspaceToolActivity
} from '@shared/types'

const quickBottomFollowThreshold = 72
const quoteReferencePrefix = 'quote_'

interface SelectionContextMenu {
  x: number
  y: number
  text: string
  html: string
  source: 'selection' | 'message'
}

interface RenderedImageContextMenu {
  x: number
  y: number
  source: string
  suggestedName?: string
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function formatTokenUnit(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 10_000 ? 0 : 1))}K`
  return `${value}`
}

function getQuickMessageTokenUsage(message: ChatMessage) {
  const storedInput = Number.isFinite(message.inputTokens) ? Math.max(0, Math.round(message.inputTokens!)) : null
  const storedOutput = Number.isFinite(message.outputTokens) ? Math.max(0, Math.round(message.outputTokens!)) : null
  const storedTotal = Number.isFinite(message.tokenCount) ? Math.max(0, Math.round(message.tokenCount!)) : null
  if (storedInput !== null && storedOutput !== null && storedTotal !== null) {
    return { total: storedTotal, input: storedInput, output: storedOutput }
  }

  const fallback = estimateTokenCount(message.content) + estimateTokenCount(message.reasoningContent ?? '')
  const input = storedInput ?? (message.role === 'user' ? fallback : 0)
  const output = storedOutput ?? (message.role === 'assistant' ? fallback : 0)
  const total = storedTotal ?? input + output
  return { total, input, output }
}

function getKnowledgeReferenceText(knowledgeRefs: KnowledgeReference[] = []): string {
  return knowledgeRefs.map((reference) => `${reference.title}\n${reference.content}`).join('\n\n')
}

function createMessage(
  role: ChatMessage['role'],
  content: string,
  attachments: PreparedAttachment[] = [],
  knowledgeRefs: KnowledgeReference[] = []
): ChatMessage {
  const contentTokens = estimateTokenCount(content)
  const knowledgeTokens = role === 'assistant' ? 0 : estimateTokenCount(getKnowledgeReferenceText(knowledgeRefs))
  const inputTokens = role === 'assistant' ? 0 : contentTokens + knowledgeTokens
  const outputTokens = role === 'assistant' ? contentTokens : 0

  return {
    id: createId('message'),
    role,
    content,
    attachments: attachments.length > 0 ? attachments : undefined,
    knowledgeRefs: knowledgeRefs.length > 0 ? knowledgeRefs : undefined,
    createdAt: Date.now(),
    tokenCount: inputTokens + outputTokens,
    inputTokens,
    outputTokens
  }
}

function createQuickConversation(assistant: Assistant, title: string, projectId?: string): Conversation {
  const now = Date.now()

  return {
    id: createId('conversation'),
    projectId,
    assistantId: assistant.id,
    title,
    messages: [],
    reasoningEffort: 'default',
    webSearchMode: 'off',
    createdAt: now,
    updatedAt: now
  }
}

function getQuickWebSearchRequestSettings(
  mode: WebSearchMode,
  conversation: Conversation
): Pick<WorkspaceAgentRequest, 'webSearchMode' | 'webSearchEnabled' | 'webSearchScope' | 'webSearchDomains'> {
  const effectiveMode = conversation.goalTask?.webSearchMode ?? mode
  return {
    webSearchMode: effectiveMode,
    webSearchEnabled: decideConversationWebSearch(effectiveMode, conversation.messages).enabled,
    webSearchScope: conversation.goalTask?.webSearchScope,
    webSearchDomains: conversation.goalTask?.webSearchDomains
  }
}

function applyChatChunk(
  conversation: Conversation,
  chunk: ChatChunk,
  timing: { startedAt?: number; completedAt?: number } = {}
): Conversation {
  const messages = [...conversation.messages]
  const last = messages.at(-1)
  const errorPresentation = chunk.error ? getChatErrorPresentation(chunk.error) : undefined
  const nextContent = errorPresentation?.userMessage ?? chunk.content

  if (!nextContent && !chunk.reasoningContent && !chunk.webSearch && !chunk.usage && !chunk.contextSavings && !chunk.cancelled && !chunk.done) {
    return { ...conversation, updatedAt: Date.now() }
  }

  if (last?.role === 'assistant') {
    const content = chunk.error ? nextContent : `${last.content}${nextContent}`
    const reasoningContent = `${last.reasoningContent ?? ''}${chunk.reasoningContent ?? ''}` || undefined
    const estimatedOutputTokens = estimateTokenCount(content) + estimateTokenCount(reasoningContent ?? '')
    messages[messages.length - 1] = {
      ...last,
      content,
      reasoningContent,
      error: errorPresentation?.technicalDetail ?? last.error,
      retryAt: errorPresentation?.automaticallyRetryable ? Date.now() + 60_000 : last.retryAt,
      webSearch: chunk.cancelled ? stopPendingWebSearch(chunk.webSearch ?? last.webSearch) : chunk.webSearch ?? last.webSearch,
      tokenCount: chunk.usage?.totalTokens ?? estimatedOutputTokens,
      inputTokens: chunk.usage?.inputTokens ?? last.inputTokens,
      outputTokens: chunk.usage?.outputTokens ?? estimatedOutputTokens,
      contextSavings: chunk.contextSavings ?? last.contextSavings,
      responseStartedAt: last.responseStartedAt ?? timing.startedAt,
      responseCompletedAt: timing.completedAt ?? last.responseCompletedAt
    }
  } else {
    if (chunk.cancelled || (!nextContent && !chunk.reasoningContent && !chunk.webSearch)) return { ...conversation, updatedAt: Date.now() }
    messages.push({
      ...createMessage('assistant', nextContent),
      reasoningContent: chunk.reasoningContent,
      error: errorPresentation?.technicalDetail,
      retryAt: errorPresentation?.automaticallyRetryable ? Date.now() + 60_000 : undefined,
      webSearch: chunk.webSearch,
      tokenCount: chunk.usage?.totalTokens ?? estimateTokenCount(nextContent) + estimateTokenCount(chunk.reasoningContent ?? ''),
      inputTokens: chunk.usage?.inputTokens ?? 0,
      outputTokens: chunk.usage?.outputTokens ?? estimateTokenCount(nextContent) + estimateTokenCount(chunk.reasoningContent ?? ''),
      contextSavings: chunk.contextSavings,
      responseStartedAt: timing.startedAt,
      responseCompletedAt: timing.completedAt
    })
  }

  const settled: Conversation = {
    ...conversation,
    messages,
    updatedAt: Date.now(),
    totalTokens: messages.reduce((sum, message) => sum + (message.tokenCount ?? 0), 0)
  }
  return chunk.done ? withQuickPendingChoice(settled) : settled
}

/** Surface a "pick one" reply as tappable cards above the quick composer. */
function withQuickPendingChoice(conversation: Conversation): Conversation {
  const last = conversation.messages[conversation.messages.length - 1]
  if (!last || last.role !== 'assistant' || last.error) {
    return conversation.pendingChoice ? { ...conversation, pendingChoice: undefined } : conversation
  }
  const extracted = extractChoicesFromReply(last.content ?? '')
  if (!extracted) {
    return conversation.pendingChoice ? { ...conversation, pendingChoice: undefined } : conversation
  }
  if (
    conversation.pendingChoice?.messageId === last.id &&
    conversation.pendingChoice.prompt === extracted.prompt &&
    conversation.pendingChoice.options.join('\u0000') === extracted.options.join('\u0000')
  ) {
    return conversation
  }
  return {
    ...conversation,
    pendingChoice: {
      prompt: extracted.prompt,
      options: extracted.options,
      messageId: last.id,
      createdAt: Date.now()
    }
  }
}

function getLatestAssistantConversation(conversations: Conversation[], assistantId: string): Conversation | null {
  return (
    conversations
      .filter((conversation) => conversation.assistantId === assistantId)
      .sort((first, second) => second.updatedAt - first.updatedAt)[0] ?? null
  )
}

function getQuickModelId(conversation: Conversation | null, assistant: Assistant, provider: ApiProvider): string {
  if (conversation?.modelProviderId === provider.id && conversation.modelId?.trim()) return conversation.modelId.trim()
  if (assistant.modelProviderId === provider.id && assistant.modelId?.trim()) return assistant.modelId.trim()
  return provider.defaultModel
}

function formatQuickWorkspaceError(value: string): string {
  return value
    .replace(/^Error invoking remote method 'workspace-agent:run':\s*Error:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

export default function QuickChat() {
  const { t, i18n } = useTranslation()
  const isWindows = window.gllm.platform === 'win32'
  const [settings, setSettings] = useState<AppSettings | null>(null)
  // Live override so the picker reflects a switch immediately, before the
  // conversation round-trip writes the workspace back.
  const [quickPermissionMode, setQuickPermissionMode] = useState<AgentPermissionMode | null>(null)
  const [providers, setProviders] = useState<ApiProvider[]>([DEFAULT_PROVIDER])
  const [assistants, setAssistants] = useState<Assistant[]>(DEFAULT_ASSISTANTS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [memories, setMemories] = useState<AssistantMemory[]>([])
  const [skills, setSkills] = useState<SkillConfig[]>([])
  const [tools, setTools] = useState<ToolConfig[]>([])
  const [activeAssistantId, setActiveAssistantId] = useState(DEFAULT_ASSISTANTS[0].id)
  const [activeProjectId, setActiveProjectId] = useState('')
  const [projects, setProjects] = useState<Project[]>([])
  const activeProjectIdRef = useRef('')
  const skillInstallationRef = useRef<Conversation | null>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  // A per-conversation override only lives as long as that conversation is open.
  useEffect(() => {
    setQuickPermissionMode(null)
  }, [conversation?.id])
  const [composerTarget, setComposerTarget] = useState<ComposerSessionTarget | null>(null)
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_PROVIDER.defaultModel)
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort>('default')
  const [draft, setDraft] = useState(() => readComposerDraft(QUICK_COMPOSER_DRAFT_KEY))
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingMessageContent, setEditingMessageContent] = useState('')
  const [selectionMenu, setSelectionMenu] = useState<SelectionContextMenu | null>(null)
  const [renderedImageMenu, setRenderedImageMenu] = useState<RenderedImageContextMenu | null>(null)
  const [imagePreview, setImagePreview] = useState<ImagePreviewSource | null>(null)
  const [pendingQuoteRefs, setPendingQuoteRefs] = useState<KnowledgeReference[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<PreparedAttachment[]>([])
  const [isPickingAttachment, setIsPickingAttachment] = useState(false)
  const [draftWorkspace, setDraftWorkspace] = useState<ConversationWorkspace | undefined>()
  const preparingWorkspaceRef = useRef(false)
  const [pendingWorkspaceRoot, setPendingWorkspaceRoot] = useState<string | null>(null)
  const [desktopSetupOpen, setDesktopSetupOpen] = useState(false)
  const [workspaceApprovalPrompt, setWorkspaceApprovalPrompt] = useState<WorkspaceApprovalPrompt | null>(null)
  const [workspaceInteraction, setWorkspaceInteraction] = useState<WorkspaceInteractionRequest | null>(null)
  const [workspaceActivities, setWorkspaceActivities] = useState<WorkspaceToolActivity[]>([])
  const [workspaceChangedFiles, setWorkspaceChangedFiles] = useState<string[]>([])
  const [goalSetupOpen, setGoalSetupOpen] = useState(false)
  const [goalModeArmed, setGoalModeArmed] = useState(false)
  const [goalAssessing, setGoalAssessing] = useState(false)
  const goalAssessingRef = useRef(false)
  const goalFlowTokenRef = useRef(0)
  const [autoFollowMessages, setAutoFollowMessages] = useState(true)
  const [isNearMessageBottom, setIsNearMessageBottom] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null)
  const autoFollowMessagesRef = useRef(true)
  const conversationRef = useRef<Conversation | null>(null)
  const streamingConversationIdRef = useRef<string | null>(null)
  const attachedWorkspaceRunRef = useRef<WorkspaceRunSnapshot | null>(null)
  const responseStartedAtRef = useRef<number | null>(null)
  const isStreamingRef = useRef(false)
  const workspaceActivitiesRef = useRef<WorkspaceToolActivity[]>([])
  const workspaceChangedFilesRef = useRef<string[]>([])
  const pendingChatChunksRef = useRef<ChatChunk[]>([])
  const chatChunkFlushTimerRef = useRef<number | null>(null)

  function updateStreaming(value: boolean) {
    isStreamingRef.current = value
    setIsStreaming(value)
  }

  function beginQuickResponse(startedAt = Date.now()) {
    responseStartedAtRef.current = startedAt
    updateStreaming(true)
  }

  function followWorkspaceRun(run?: WorkspaceRunSnapshot) {
    if (streamingConversationIdRef.current || (!run && !attachedWorkspaceRunRef.current)) return
    attachedWorkspaceRunRef.current = run ?? null
    if (run) {
      beginQuickResponse(run.startedAt)
      workspaceActivitiesRef.current = run.activities
      workspaceChangedFilesRef.current = run.changedFiles
      setWorkspaceActivities(run.activities)
      setWorkspaceChangedFiles(run.changedFiles)
    } else {
      responseStartedAtRef.current = null
      updateStreaming(false)
    }
  }

  const assistant = useMemo(() => getAssistantById(activeAssistantId, assistants), [activeAssistantId, assistants])
  const assistantDisplay = useMemo(
    () => localizeAssistant(assistant),
    [assistant, i18n.resolvedLanguage]
  )
  const assistantMemories = useMemo(
    () => memories.filter((memory) => memory.assistantId === assistant.id && memory.enabled),
    [assistant.id, memories]
  )
  const assistantSkills = useMemo(
    () => resolveAssistantSkills(assistant, skills),
    [assistant, skills]
  )
  const assistantTools = useMemo(
    () => resolveAssistantTools(assistant, tools),
    [assistant, tools]
  )
  const provider = useMemo(
    () => {
      const providerId = conversation?.modelProviderId || assistant.modelProviderId || settings?.activeProviderId
      return providerId ? getProviderById(providerId, providers) : providers[0] ?? DEFAULT_PROVIDER
    },
    [assistant.modelProviderId, conversation?.modelProviderId, providers, settings]
  )
  const activeModelId = resolveProviderModelId(provider, selectedModelId)
  const selectedProvider = useMemo(
    () => ({
      ...provider,
      defaultModel: activeModelId,
      models: getModelOptions(provider, activeModelId)
    }),
    [activeModelId, provider]
  )
  const needsApiKey = Boolean(settings && isProviderApiKeyMissing(selectedProvider))
  const missingProviderMessage = isManagedGllmProvider(selectedProvider) ? t('account.signInFirst') : t('quickChat.configureProviderApiKey', { provider: selectedProvider.name })
  const messageSendShortcut = settings?.messageSendShortcut ?? 'enter'
  const messageSendShortcutLabel = getMessageSendShortcutLabel(messageSendShortcut)
  const messages = conversation?.messages ?? []
  const currentWorkspace = conversationWorkspace(conversation, draftWorkspace) ?? projectWorkspace(projects.find(project => project.id === activeProjectId))
  const effectivePermissionMode: AgentPermissionMode =
    quickPermissionMode ?? currentWorkspace?.approvalMode ?? settings?.agentPermissionMode ?? 'ask'
  const webSearchMode: WebSearchMode = settings?.webSearchMode ?? 'off'
  const quickDraftStorageKey = composerTarget
    ? getComposerDraftStorageKey(getComposerSessionKey(
        composerTarget.conversationId,
        composerTarget.projectId,
        composerTarget.assistantId
      ))
    : QUICK_COMPOSER_DRAFT_KEY

  function applyQuickState(
    state: Awaited<ReturnType<typeof window.gllm.getState>>,
    fallbackAssistantId: string,
    requestedTarget: ComposerSessionTarget | null
  ) {
    const loadedProviders = state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER]
    const visibleStateAssistants = state.assistants.filter((item) => !item.hidden)
    const loadedAssistants = visibleStateAssistants.length > 0 ? visibleStateAssistants : DEFAULT_ASSISTANTS
    const requestedAssistantId = requestedTarget?.assistantId ?? fallbackAssistantId
    const quickAssistant = getAssistantById(requestedAssistantId, loadedAssistants)
    const exactConversation = requestedTarget?.conversationId
      ? state.conversations.find((item) => (
          item.id === requestedTarget.conversationId &&
          item.assistantId === quickAssistant.id &&
          (!requestedTarget.projectId || item.projectId === requestedTarget.projectId)
        )) ?? null
      : null
    const selectedConversation = requestedTarget ? exactConversation : getLatestAssistantConversation(state.conversations, quickAssistant.id)
    const target: ComposerSessionTarget = requestedTarget ?? {
      conversationId: selectedConversation?.id,
      projectId: state.activeProjectId || undefined,
      assistantId: quickAssistant.id
    }
    const initialProvider = state.settings
      ? getProviderById(selectedConversation?.modelProviderId || quickAssistant.modelProviderId || state.settings.activeProviderId, loadedProviders)
      : loadedProviders[0] ?? DEFAULT_PROVIDER

    setSettings(state.settings)
    setProviders(loadedProviders)
    setAssistants(loadedAssistants)
    setConversations(state.conversations)
    setMemories(state.memories ?? [])
    setSkills(state.skills ?? [])
    setTools(state.tools ?? [])
    setProjects(state.projects)
    setActiveProjectId(state.activeProjectId)
    activeProjectIdRef.current = state.activeProjectId
    setActiveAssistantId(quickAssistant.id)
    setComposerTarget(target)
    setConversation(selectedConversation)
    conversationRef.current = selectedConversation
    followWorkspaceRun(state.workspaceRuns.find(run => run.conversationId === selectedConversation?.id))
    setDraft(readComposerDraft(getComposerDraftStorageKey(getComposerSessionKey(
      target.conversationId,
      target.projectId,
      target.assistantId
    ))))
    setSelectedModelId(getQuickModelId(selectedConversation, quickAssistant, initialProvider))
    setSelectedReasoningEffort(selectedConversation?.reasoningEffort ?? 'default')
  }

  useEffect(() => window.gllm.onStorageLocationChanged?.((state, previousRoot) => {
    setProjects(state.projects)
    setConversations(state.conversations)
    setSkills(state.skills)
    const current = conversationRef.current
    if (current) {
      const updated = state.conversations.find(item => item.id === current.id)
      if (updated) { setConversation(updated); conversationRef.current = updated }
    }
    setDraftWorkspace(current => current ? { ...current, rootPath: relocateWorkspaceLocation(current.rootPath, previousRoot, state.dataLocation.activePath, window.gllm.platform === 'win32') } : undefined)
  }), [])

  useEffect(() => {
    void Promise.all([
      window.gllm.getState(),
      window.gllm.getActiveAssistantId(),
      window.gllm.getMainComposerTarget()
    ]).then(([state, activeId, target]) => applyQuickState(state, activeId, target))
  }, [])

  useEffect(() => window.gllm.onQuickComposerTargetRequested((target) => {
    void (async () => {
      let state = await window.gllm.getState()
      if (target.projectId && state.activeProjectId !== target.projectId) {
        state = await window.gllm.setActiveProjectId(target.projectId)
      }
      applyQuickState(state, target.assistantId, target)
    })()
  }), [])

  useEffect(() => {
    if (settings) applyDocumentTheme(settings.theme, true)
  }, [settings?.theme])

  useEffect(() => {
    if (settings) applyRendererLanguage(settings.language)
  }, [settings?.language])

  useEffect(() => {
    if (!settings) return
    primeOverlayPipeline((key) => String(t(key)), settings.language)
  }, [settings?.language, t])

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

  useEffect(() => window.gllm.onAssistantCapabilitiesChanged((change) => {
    if (change.projectId !== activeProjectIdRef.current) return
    setAssistants(change.assistants)
    setSkills(change.skills)
  }), [])

  useEffect(() => {
    return window.gllm.onDeepLinkHandoffStatus(({ status }) => {
      if (status !== 'success') return
      void window.gllm.getState().then((state) => {
        setSettings(state.settings)
        setProviders(state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER])
      })
    })
  }, [])

  useEffect(() => {
    return window.gllm.onActiveAssistantChanged((id) => {
      setActiveAssistantId(id)
      setDraftWorkspace(undefined)
      setDraft('')
      setPendingQuoteRefs([])
      setPendingAttachments([])
      setStatus('')
    })
  }, [])

  useEffect(() => {
    return window.gllm.onChatActivity((activity) => {
      if (activity.kind !== 'workspace' || activity.conversationId !== conversationRef.current?.id) return
      if (activity.active) {
        followWorkspaceRun({ conversationId: activity.conversationId, startedAt: activity.startedAt ?? Date.now(), activities: [], changedFiles: [] })
      } else if (attachedWorkspaceRunRef.current?.conversationId === activity.conversationId) {
        followWorkspaceRun()
      }
    })
  }, [])

  useEffect(() => {
    return window.gllm.onWorkspaceAgentProgress((progress) => {
      if (conversationRef.current?.id !== progress.conversationId) return
      setWorkspaceActivities((current) => {
        const index = current.findIndex((activity) => activity.id === progress.activity.id)
        const next = index >= 0
          ? current.map((activity, activityIndex) => activityIndex === index ? progress.activity : activity)
          : [...current, progress.activity].slice(-WORKSPACE_ACTIVITY_HISTORY)
        workspaceActivitiesRef.current = next
        return next
      })
      if (progress.changedFiles) {
        workspaceChangedFilesRef.current = progress.changedFiles
        setWorkspaceChangedFiles(progress.changedFiles)
      }
    })
  }, [])

  useEffect(() => window.gllm.onWorkspaceApprovalRequested(setWorkspaceApprovalPrompt), [])

  // Structured agent questions raised while this quick window is the active one.
  useEffect(() => {
    const offRequested = window.gllm.onWorkspaceInteractionRequested(setWorkspaceInteraction)
    const offResolved = window.gllm.onWorkspaceInteractionResolved(({ id }) => {
      setWorkspaceInteraction((current) => current?.id === id ? null : current)
    })
    void window.gllm.listPendingWorkspaceInteractions().then((requests) => {
      setWorkspaceInteraction((current) => current ?? requests[0] ?? null)
    }).catch(() => undefined)
    return () => { offRequested(); offResolved() }
  }, [])

  useEffect(() => {
    scheduleComposerDraftPersist(quickDraftStorageKey, draft)
  }, [draft, quickDraftStorageKey])

  useEffect(() => {
    if (composerTarget) window.gllm.setQuickComposerTarget(composerTarget)
  }, [composerTarget])

  useEffect(() => {
    const nextTarget: ComposerSessionTarget = {
      conversationId: conversation?.id,
      projectId: conversation?.projectId ?? (activeProjectId || undefined),
      assistantId: conversation?.assistantId ?? activeAssistantId
    }
    if (
      composerTarget?.conversationId === nextTarget.conversationId &&
      composerTarget?.projectId === nextTarget.projectId &&
      composerTarget?.assistantId === nextTarget.assistantId
    ) return
    setComposerTarget(nextTarget)
  }, [activeAssistantId, activeProjectId, conversation?.assistantId, conversation?.id, conversation?.projectId])

  useEffect(() => {
    resizeComposerTextarea(draftTextareaRef.current)
  }, [draft])

  useEffect(() => {
    if (!selectionMenu && !renderedImageMenu) return

    const closeMenu = () => {
      setSelectionMenu(null)
      setRenderedImageMenu(null)
    }
    const closeMenuOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [selectionMenu, renderedImageMenu])

  useEffect(() => {
    if (isStreaming) return
    if (composerTarget) {
      setConversation(composerTarget.conversationId
        ? conversations.find((item) => item.id === composerTarget.conversationId && item.assistantId === assistant.id) ?? null
        : null)
      return
    }
    setConversation(getLatestAssistantConversation(conversations, assistant.id))
  }, [assistant.id, composerTarget, conversations, isStreaming])

  useEffect(() => {
    setSelectedModelId(getQuickModelId(conversation, assistant, provider))
  }, [assistant, conversation?.id, conversation?.modelId, conversation?.modelProviderId, provider])

  useEffect(() => {
    setSelectedReasoningEffort(conversation?.reasoningEffort ?? 'default')
  }, [conversation?.id, conversation?.reasoningEffort])

  useEffect(() => {
    return window.gllm.onConversationChanged((change) => {
      const liveConversation = conversationRef.current
      if (change.action === 'deleted') {
        const mergedConversations = change.conversations ?? []
        setConversations(mergedConversations)
        setConversation((current) => {
          if (current?.id !== change.conversationId) return current
          streamingConversationIdRef.current = null
          return getLatestAssistantConversation(mergedConversations, assistant.id)
        })
        return
      }

      const changedConversation = liveConversation?.id === streamingConversationIdRef.current && liveConversation.id === change.conversationId
        ? liveConversation
        : change.conversation
      if (!changedConversation) return
      setConversations((current) => mergeConversationChange(current, change, changedConversation))
      setConversation((current) => {
        if (change.action === 'metadata') {
          return current?.id === changedConversation.id ? changedConversation : current
        }

        if (current?.id === streamingConversationIdRef.current) return current

        if (!current || current.id === change.conversationId) return changedConversation

        return current
      })
    })
  }, [assistant.id])

  useEffect(() => {
    conversationRef.current = conversation
  }, [conversation])

  useEffect(() => {
    setEditingMessageId(null)
    setEditingMessageContent('')
    setMessageAutoFollow(true)
    setIsNearMessageBottom(true)
    setDraftWorkspace(undefined)
    const run = attachedWorkspaceRunRef.current?.conversationId === conversation?.id ? attachedWorkspaceRunRef.current : null
    workspaceActivitiesRef.current = run?.activities ?? []
    workspaceChangedFilesRef.current = run?.changedFiles ?? []
    setWorkspaceActivities(workspaceActivitiesRef.current)
    setWorkspaceChangedFiles(workspaceChangedFilesRef.current)
    window.requestAnimationFrame(() => scrollToLatest('auto', { resumeAutoFollow: true }))
  }, [conversation?.id])

  useEffect(() => {
    const flushChatChunks = () => {
      chatChunkFlushTimerRef.current = null
      const chunks = coalesceChatChunks(pendingChatChunksRef.current.splice(0))
      if (chunks.length === 0) return
      const responseStartedAt = responseStartedAtRef.current ?? undefined
      const completedAt = Date.now()

      setConversation((active) => {
        if (!active) return active
        let next = active
        for (const chunk of chunks) {
          if (next.id !== chunk.conversationId) continue
          next = applyChatChunk(next, chunk, {
            startedAt: responseStartedAt,
            completedAt: chunk.done ? completedAt : undefined
          })
        }
        if (next === active) return active
        conversationRef.current = next
        setConversations((current) => [next, ...current.filter((item) => item.id !== next.id)])
        if (chunks.some((chunk) => chunk.conversationId === next.id && chunk.done)) {
          void window.gllm.saveConversation(next)
        }
        return next
      })

      for (const chunk of chunks) {
        if (!chunk.done) continue
        streamingConversationIdRef.current = null
        responseStartedAtRef.current = null
        updateStreaming(false)
        if (chunk.error) {
          setStatus(getChatErrorPresentation(chunk.error).userMessage)
        } else if (chunk.warning) {
          setStatus(chunk.warning)
        }
      }
    }

    const unsubscribe = window.gllm.onChatChunk((chunk) => {
      const current = conversationRef.current
      if (!current || current.id !== chunk.conversationId) return

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
    if (!autoFollowMessages) return
    const container = messagesRef.current
    if (!container) return
    window.requestAnimationFrame(() => scrollToLatest(isStreaming ? 'auto' : 'smooth', { requireAutoFollow: true, resumeAutoFollow: false }))
  }, [autoFollowMessages, isStreaming, messages.length, messages.at(-1)?.content])

  function getDistanceToMessageBottom() {
    const container = messagesRef.current
    if (!container) return 0
    return container.scrollHeight - container.scrollTop - container.clientHeight
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
    const container = messagesRef.current
    if (event.deltaY < 0 && container && container.scrollTop > 0) pauseMessageAutoFollow()
  }

  function updateMessageScrollState() {
    setSelectionMenu(null)
    const distanceToBottom = getDistanceToMessageBottom()
    const isAtBottom = distanceToBottom <= 4
    const isNearBottom = distanceToBottom <= quickBottomFollowThreshold

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

    const container = messagesRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior })
    if (options.resumeAutoFollow ?? true) {
      setIsNearMessageBottom(true)
      setMessageAutoFollow(true)
    }
  }

  async function openMainWindow() {
    const current = conversationRef.current
    let target = current
    if (current) {
      try {
        const saved = await window.gllm.saveConversation(current)
        target = saved
        conversationRef.current = saved
        setConversation(saved)
        setConversations((items) => [saved, ...items.filter((item) => item.id !== saved.id)])
      } catch {
        // The conversation was already persisted before streaming started. A
        // transient save failure should not prevent the user opening main UI.
      }
    }

    const handoffTarget: ComposerSessionTarget = {
      conversationId: target?.id,
      projectId: target?.projectId ?? (activeProjectId || undefined),
      assistantId: target?.assistantId ?? activeAssistantId
    }
    persistComposerDraft(quickDraftStorageKey, draft)
    await window.gllm.showMainWindow(undefined, handoffTarget)
    await window.gllm.hideQuickPanel()
  }

  function startNewQuickChat() {
    setConversation(null)
    setComposerTarget({ projectId: activeProjectId || undefined, assistantId: activeAssistantId })
    setDraftWorkspace(undefined)
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    setWorkspaceChangedFiles([])
    workspaceChangedFilesRef.current = []
    setDraft('')
    setPendingQuoteRefs([])
    setPendingAttachments([])
    setStatus('')
  }

  async function confirmQuickWorkspace(approvalMode: NonNullable<ConversationWorkspace['approvalMode']>) {
    const rootPath = pendingWorkspaceRoot
    if (!rootPath) return
    setPendingWorkspaceRoot(null)
    try {
      const workspace: ConversationWorkspace = {
        rootPath,
        displayName: rootPath.split(/[\\/]/).filter(Boolean).at(-1) || t('workspace.defaultName'),
        permission: 'read-write',
        approvalMode,
        grantedAt: Date.now(),
        lastVerifiedAt: Date.now()
      }
      setWorkspaceActivities([])
      workspaceActivitiesRef.current = []
      if (!conversation) {
        setDraftWorkspace(workspace)
        setStatus('')
        return
      }
      const nextConversation = { ...conversation, workspace, updatedAt: Date.now() }
      setConversation(nextConversation)
      setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
      conversationRef.current = nextConversation
      await window.gllm.saveConversation(nextConversation)
      setStatus('')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('workspace.bindFailed'))
    }
  }

  async function saveDesktopWorkspace(workspace: ConversationWorkspace) {
    if (!conversation) { setDraftWorkspace(workspace); return }
    const saved = await window.gllm.saveConversation({ ...conversation, workspace, updatedAt: Date.now() })
    setConversation(saved)
    setConversations(current => [saved, ...current.filter(item => item.id !== saved.id)])
    conversationRef.current = saved
    if (!workspace.browserAccess) await window.gllm.closeAgentBrowser(saved.id)
  }

  async function changeQuickWorkspaceApproval(approvalMode: NonNullable<ConversationWorkspace['approvalMode']>, agentSettings?: WorkspaceAgentSettings) {
    if (!currentWorkspace) return
    const workspace = { ...currentWorkspace, ...agentSettings, approvalMode, lastVerifiedAt: Date.now() }
    if (!conversation) {
      setDraftWorkspace(workspace)
      return
    }
    await saveDesktopWorkspace(workspace)
  }

  async function changeQuickPermissionMode(mode: AgentPermissionMode) {
    setQuickPermissionMode(mode)
    if (!conversation) {
      if (currentWorkspace) await changeQuickWorkspaceApproval(mode)
      return
    }
    try {
      const change = await window.gllm.setAgentPermissionMode(conversation.id, mode)
      if (!change.persisted && currentWorkspace) await changeQuickWorkspaceApproval(mode)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('agentPermission.changeFailed'))
    }
  }

  async function acknowledgeQuickFullAccess() {
    try {
      setSettings(await window.gllm.acknowledgeFullAccess())
    } catch {
      /* The acknowledgement is a convenience flag; a failure must not block the switch. */
    }
  }

  async function unbindQuickWorkspace() {
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    setWorkspaceChangedFiles([])
    workspaceChangedFilesRef.current = []
    if (!conversation) {
      setDraftWorkspace(undefined)
      return
    }
    window.gllm.cancelResponse(conversation.id)
    void window.gllm.closeAgentBrowser(conversation.id)
    if (workspaceApprovalPrompt?.conversationId === conversation.id) window.gllm.respondWorkspaceApproval(workspaceApprovalPrompt.id, false)
    setWorkspaceApprovalPrompt(null)
    setDraftWorkspace(undefined)
    const nextConversation = { ...conversation, workspace: undefined, updatedAt: Date.now() }
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    try {
      await window.gllm.saveConversation(nextConversation)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('workspace.unbindFailed'))
    }
  }

  async function chooseQuickGoalWorkspace(): Promise<string | null> {
    try {
      return await window.gllm.chooseWorkspaceDirectory()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('workspace.bindFailed'))
      return null
    }
  }

  async function startQuickGoalMode(value: GoalSetupValue) {
    if (!settings || isStreamingRef.current) return
    if ((assistant.status ?? 'active') !== 'active') {
      setStatus(t('assistantSettings.inactiveNotice'))
      return
    }
    if (needsApiKey) {
      setStatus(missingProviderMessage)
      return
    }
    const normalizePath = (path: string) => {
      const normalized = path.replace(/[\\/]+$/, '').replace(/\\/g, '/')
      return window.gllm.platform === 'linux' ? normalized : normalized.toLocaleLowerCase()
    }
    const conflict = conversations.find((item) =>
      item.id !== conversation?.id &&
      item.workspace?.permission === 'read-write' &&
      normalizePath(item.workspace.rootPath) === normalizePath(value.rootPath)
    )
    if (conflict) {
      setGoalSetupOpen(false)
      setStatus(t('workspace.folderConflict', { conversation: conflict.title }))
      return
    }

    const now = Date.now()
    const workspace: ConversationWorkspace = {
      ...(currentWorkspace?.rootPath === value.rootPath ? currentWorkspace : {}),
      rootPath: value.rootPath,
      displayName: value.rootPath.split(/[\\/]/).filter(Boolean).at(-1) || t('workspace.defaultName'),
      permission: 'read-write',
      approvalMode: value.approvalMode,
      grantedAt: currentWorkspace?.rootPath === value.rootPath ? currentWorkspace.grantedAt : now,
      lastVerifiedAt: now
    }
    const goalTask: GoalTask = {
      id: createId('goal'),
      goal: value.goal,
      acceptanceCriteria: value.acceptanceCriteria,
      status: 'running',
      webSearchMode: value.webSearchMode,
      webSearchScope: value.webSearchScope,
      webSearchDomains: value.webSearchDomains,
      contextMode: value.contextMode,
      resolvedContextMode: resolveGoalContextMode(
        value.contextMode,
        value.goal,
        value.acceptanceCriteria,
        conversation?.goalTask,
        conversation?.messages ?? []
      ),
      runCount: 1,
      startedAt: now,
      lastRunStartedAt: now,
      updatedAt: now
    }
    const baseConversation = conversation ?? createQuickConversation(
      assistant,
      value.goal.slice(0, 28),
      activeProjectId || undefined
    )
    const goalMessage = createMessage('user', t('goalMode.executionPrompt', {
      goal: value.goal,
      criteria: value.acceptanceCriteria || t('goalMode.inferAcceptance')
    }))
    goalTask.contextStartMessageId = goalMessage.id
    const nextConversation: Conversation = {
      ...baseConversation,
      workspace,
      goalTask,
      title: value.goal.slice(0, 28),
      messages: [...baseConversation.messages, goalMessage],
      modelProviderId: selectedProvider.id,
      modelId: selectedProvider.defaultModel,
      reasoningEffort: selectedReasoningEffort,
      updatedAt: now
    }

    setGoalSetupOpen(false)
    setDraft('')
    setDraftWorkspace(undefined)
    setStatus('')
    beginQuickResponse(now)
    streamingConversationIdRef.current = nextConversation.id
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    await executeQuickWorkspaceConversation(nextConversation, workspace)
  }

  function setQuickGoalStatus(nextStatus: 'paused' | 'stopped') {
    const current = conversationRef.current
    if (!current?.goalTask) return
    if (isStreamingRef.current) window.gllm.cancelResponse(current.id)
    const updated: Conversation = {
      ...current,
      goalTask: {
        ...current.goalTask,
        status: nextStatus,
        updatedAt: Date.now(),
        completedAt: nextStatus === 'stopped' ? Date.now() : undefined
      },
      updatedAt: Date.now()
    }
    streamingConversationIdRef.current = null
    responseStartedAtRef.current = null
    updateStreaming(false)
    setConversation(updated)
    setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)])
    conversationRef.current = updated
    void window.gllm.saveConversation(updated)
    setStatus(t(nextStatus === 'paused' ? 'goalMode.pausedNotice' : 'goalMode.stoppedNotice'))
  }

  function clearQuickGoal() {
    const current = conversationRef.current
    if (!current?.goalTask || !window.confirm(t('goalMode.confirmClear'))) return
    if (isStreamingRef.current) window.gllm.cancelResponse(current.id)
    const updated: Conversation = {
      ...current,
      goalTask: undefined,
      updatedAt: Date.now()
    }
    streamingConversationIdRef.current = null
    responseStartedAtRef.current = null
    updateStreaming(false)
    setConversation(updated)
    setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)])
    conversationRef.current = updated
    void window.gllm.saveConversation(updated)
    setStatus(t('goalMode.clearedNotice'))
  }

  async function resumeQuickGoal() {
    const current = conversationRef.current
    if (!settings || isStreamingRef.current || !current?.goalTask || !current.workspace) return
    if ((assistant.status ?? 'active') !== 'active' || needsApiKey) {
      setStatus(needsApiKey ? missingProviderMessage : t('assistantSettings.inactiveNotice'))
      return
    }
    const now = Date.now()
    const goalTask: GoalTask = {
      ...current.goalTask,
      status: 'running',
      runCount: current.goalTask.runCount + 1,
      lastRunStartedAt: now,
      updatedAt: now,
      completedAt: undefined,
      lastError: undefined
    }
    const resumeMessage = createMessage('user', t('goalMode.resumePrompt', {
      goal: goalTask.goal,
      criteria: goalTask.acceptanceCriteria || t('goalMode.inferAcceptance')
    }))
    const updated: Conversation = {
      ...current,
      goalTask,
      messages: [...current.messages, resumeMessage],
      updatedAt: now
    }
    setStatus('')
    beginQuickResponse(now)
    streamingConversationIdRef.current = updated.id
    setConversation(updated)
    setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)])
    conversationRef.current = updated
    void window.gllm.saveConversation(updated)
    await executeQuickWorkspaceConversation(updated, current.workspace)
  }

  async function executeQuickWorkspaceConversation(
    nextConversation: Conversation,
    workspace: ConversationWorkspace,
    retryAttempts: MessageRetryAttempt[] = []
  ) {
    if (!settings) return
    const goalTask = nextConversation.goalTask?.status === 'running' ? nextConversation.goalTask : undefined
    const responseStartedAt = responseStartedAtRef.current ?? nextConversation.messages.at(-1)?.createdAt ?? Date.now()
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    setWorkspaceChangedFiles([])
    workspaceChangedFilesRef.current = []
    try {
      const completedConversation = await window.gllm.runWorkspaceAgent({
        conversationId: nextConversation.id,
        goalId: goalTask?.id,
        retryAttempts,
        assistant,
        assistantSkills,
        assistantTools,
        availableAssistants: assistants,
        workspace,
        provider: selectedProvider,
        messages: selectGoalContextMessages(nextConversation.messages, goalTask),
        settings,
        reasoningEffort: nextConversation.reasoningEffort,
        ...getQuickWebSearchRequestSettings(webSearchMode, nextConversation),
        projectMemory: goalTask?.resolvedContextMode === 'isolated' ? undefined : nextConversation.projectMemory
      })
      const settledConversation = withQuickPendingChoice(completedConversation)
      setConversation(settledConversation)
      setConversations((current) => [settledConversation, ...current.filter((item) => item.id !== settledConversation.id)])
      conversationRef.current = settledConversation
      if (settledConversation !== completedConversation) void window.gllm.saveConversation(settledConversation)
      const changedFiles = completedConversation.messages.at(-1)?.workspaceChangedFiles?.length ?? 0
      if (changedFiles > 0) setStatus(t('workspace.filesChanged', { count: changedFiles }))
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : t('workspaceErrors.unknown')
      if (rawMessage.includes(WORKSPACE_ALREADY_RUNNING)) {
        setStatus(formatQuickWorkspaceError(rawMessage.replace(`${WORKSPACE_ALREADY_RUNNING}:`, '')))
        return
      }
      if (/AbortError|aborted|任务已停止/i.test(rawMessage)) {
        setStatus(t('workspace.generationStopped'))
        return
      }
      const message = formatQuickWorkspaceError(rawMessage)
      const attempt: MessageRetryAttempt = {
        attemptedAt: Date.now(),
        error: message,
        activities: workspaceActivitiesRef.current
      }
      const failedMessage: ChatMessage = {
        ...createMessage('assistant', t('workspace.taskFailed', { message })),
        responseStartedAt,
        responseCompletedAt: Date.now(),
        error: message,
        workspaceActivities: workspaceActivitiesRef.current,
        workspaceChangedFiles: workspaceChangedFilesRef.current,
        workspaceArtifactRoot: workspace.rootPath,
        retryAttempts: [...retryAttempts, attempt]
      }
      const nextMessages = [...nextConversation.messages, failedMessage]
      const failedConversation: Conversation = {
        ...nextConversation,
        workspace,
        goalTask: goalTask
          ? {
              ...goalTask,
              status: 'failed',
              lastError: message,
              updatedAt: Date.now()
            }
          : nextConversation.goalTask,
        messages: nextMessages,
        totalTokens: nextMessages.reduce((sum, item) => sum + (item.tokenCount ?? 0), 0),
        updatedAt: Date.now()
      }
      setConversation(failedConversation)
      setConversations((current) => [failedConversation, ...current.filter((item) => item.id !== failedConversation.id)])
      conversationRef.current = failedConversation
      await window.gllm.saveConversation(failedConversation)
    } finally {
      setWorkspaceApprovalPrompt(null)
      streamingConversationIdRef.current = null
      responseStartedAtRef.current = null
      updateStreaming(false)
    }
  }

  async function pickQuickAttachments(kind: AttachmentKind) {
    if (isPickingAttachment) return
    setIsPickingAttachment(true)
    try {
      const picked = await window.gllm.pickAttachments(kind)
      if (picked.length === 0) return
      setPendingAttachments((current) => [...current, ...picked].slice(0, 8))
      setStatus(t('quickChat.attachmentsAdded', { count: picked.length }))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('quickChat.attachmentPickFailed'))
    } finally {
      setIsPickingAttachment(false)
    }
  }

  async function captureQuickScreenshot() {
    if (isPickingAttachment) return
    setIsPickingAttachment(true)
    try {
      setStatus(t('quickChat.selectScreenshotArea'))
      const screenshot = await window.gllm.captureScreenshot()
      if (!screenshot) {
        setStatus(t('quickChat.noScreenshot'))
        return
      }
      setPendingAttachments((current) => [...current, screenshot].slice(0, 8))
      setStatus(t('quickChat.screenshotAdded'))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('quickChat.screenshotFailed'))
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }

  async function handleQuickPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files ?? []).slice(0, 8)
    if (files.length === 0 || isPickingAttachment) return

    event.preventDefault()
    setIsPickingAttachment(true)
    try {
      const inputs = await Promise.all(files.map(async (file, index) => ({
        name: file.name || t('quickChat.pastedAttachmentName', { index: index + 1 }),
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        kind: file.type.startsWith('image/') ? 'image' as const : 'file' as const,
        dataUrl: file.size <= 12 * 1024 * 1024
          ? await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onerror = () => reject(reader.error ?? new Error(t('quickChat.clipboardReadFailed')))
              reader.onload = () => resolve(String(reader.result ?? ''))
              reader.readAsDataURL(file)
            })
          : undefined
      })))
      const prepared = await window.gllm.preparePastedAttachments(inputs)
      setPendingAttachments((current) => [...current, ...prepared].slice(0, 8))
      if (prepared.length > 0) setStatus(t('quickChat.clipboardAttachmentsAdded', { count: prepared.length }))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('quickChat.clipboardAttachmentFailed'))
    } finally {
      setIsPickingAttachment(false)
    }
  }

  function saveQuickConversationModel(modelId: string, reasoningEffort: ReasoningEffort) {
    const currentConversation = conversationRef.current ?? conversation
    const sourceConversation = attachDraftWorkspace(
      currentConversation ?? createQuickConversation(
        assistant,
        assistantDisplay.name,
        activeProjectId || undefined
      ),
      currentConversation ? undefined : draftWorkspace
    )
    const nextConversation = applyConversationModelSelection(
      sourceConversation,
      provider.id,
      modelId,
      reasoningEffort
    )

    if (!currentConversation) {
      const target: ComposerSessionTarget = {
        conversationId: nextConversation.id,
        projectId: nextConversation.projectId,
        assistantId: nextConversation.assistantId
      }
      const nextDraftStorageKey = getComposerDraftStorageKey(getComposerSessionKey(
        target.conversationId,
        target.projectId,
        target.assistantId
      ))
      persistComposerDraft(nextDraftStorageKey, draft)
      if (nextDraftStorageKey !== quickDraftStorageKey) persistComposerDraft(quickDraftStorageKey, '')
      setComposerTarget(target)
      window.gllm.setQuickComposerTarget(target)
      setDraftWorkspace(undefined)
    }

    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
  }

  function changeModel(modelId: string) {
    setSelectedModelId(modelId)
    saveQuickConversationModel(modelId, selectedReasoningEffort)
  }

  function changeReasoningEffort(reasoningEffort: ReasoningEffort) {
    setSelectedReasoningEffort(reasoningEffort)
    saveQuickConversationModel(selectedModelId, reasoningEffort)
  }

  function changeModelAndReasoning(modelId: string, reasoningEffort: ReasoningEffort) {
    setSelectedModelId(modelId)
    setSelectedReasoningEffort(reasoningEffort)
    saveQuickConversationModel(modelId, reasoningEffort)
  }

  async function changeWebSearchMode(nextMode: WebSearchMode) {
    if (!settings || webSearchMode === nextMode) return

    const saved = await window.gllm.saveSettings({ ...settings, webSearchMode: nextMode })
    setSettings(saved)
    const labelKey = nextMode === 'auto'
      ? 'app.webSearchModeAuto'
      : nextMode === 'on'
        ? 'app.webSearchModeOn'
        : 'app.webSearchModeOff'
    setStatus(t('app.webSearchModeChanged', { mode: t(labelKey) }))
  }

  function retryMessage(messageId: string) {
    if (!settings || isStreamingRef.current || !conversation) return

    if (needsApiKey) {
      setStatus(missingProviderMessage)
      void openMainWindow()
      return
    }

    const messageIndex = conversation.messages.findIndex((message) => message.id === messageId)
    if (messageIndex <= 0) return

    const message = conversation.messages[messageIndex]
    const messages = conversation.messages.slice(0, messageIndex)
    if (!messages.some((message) => message.role === 'user')) return

    const nextConversation: Conversation = {
      ...conversation,
      messages,
      modelProviderId: selectedProvider.id,
      modelId: selectedProvider.defaultModel,
      reasoningEffort: selectedReasoningEffort,
      updatedAt: Date.now()
    }

    setStatus('')
    beginQuickResponse()
    streamingConversationIdRef.current = nextConversation.id
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    if (usesWorkspaceAgent(nextConversation)) {
      const retryAttempts = message.error
        ? message.retryAttempts?.length
          ? message.retryAttempts
          : [{ attemptedAt: message.createdAt, error: formatQuickWorkspaceError(message.error), activities: message.workspaceActivities }]
        : []
      void executeQuickWorkspaceConversation(nextConversation, nextConversation.workspace, retryAttempts)
      return
    }
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant,
      assistantMemories,
      assistantSkills,
      provider: selectedProvider,
      messages: nextConversation.messages,
      settings,
      reasoningEffort: nextConversation.reasoningEffort,
      ...getQuickWebSearchRequestSettings(webSearchMode, nextConversation)
    })
  }

  function resumeWorkspaceTask() {
    const current = conversationRef.current
    if (!settings || isStreamingRef.current || !current || !usesWorkspaceAgent(current) || !hasUnfinishedWorkspaceTask(current)) return
    if ((assistant.status ?? 'active') !== 'active' || needsApiKey) {
      setStatus(needsApiKey ? missingProviderMessage : t('assistantSettings.inactiveNotice'))
      return
    }
    const latest = current.messages.at(-1)
    if (latest?.role === 'assistant') {
      retryMessage(latest.id)
      return
    }
    setStatus('')
    beginQuickResponse()
    streamingConversationIdRef.current = current.id
    setMessageAutoFollow(true)
    void executeQuickWorkspaceConversation(current, current.workspace)
  }

  function cancelQuickWorkspaceTask() {
    const current = conversationRef.current
    if (!current || !hasUnfinishedWorkspaceTask(current)) return
    if (!window.confirm(t('workspace.cancelTaskConfirm'))) return
    const cancelMessage = createMessage('assistant', t('workspace.cancelledMessage'))
    const updated: Conversation = {
      ...current,
      messages: [...current.messages, cancelMessage],
      updatedAt: Date.now()
    }
    void window.gllm.removeWorkspaceCheckpoint(current.id)
    setConversation(updated)
    setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)])
    conversationRef.current = updated
    void window.gllm.saveConversation(updated)
    setStatus(t('workspace.cancelledNotice'))
  }

  function editQuickMessage(message: ChatMessage) {
    if (isStreaming || message.role !== 'user') return
    setEditingMessageId(message.id)
    setEditingMessageContent(message.content)
  }

  function cancelQuickMessageEdit() {
    setEditingMessageId(null)
    setEditingMessageContent('')
  }

  function resendEditedQuickMessage(messageId: string) {
    if (!settings || isStreamingRef.current || !conversation) return
    if (needsApiKey) {
      setStatus(missingProviderMessage)
      void openMainWindow()
      return
    }

    const messageIndex = conversation.messages.findIndex((message) => message.id === messageId)
    const originalMessage = conversation.messages[messageIndex]
    const content = editingMessageContent.trim()
    if (messageIndex < 0 || originalMessage?.role !== 'user' || !content) return

    const editedMessage = createMessage(
      'user',
      content,
      originalMessage.attachments,
      originalMessage.knowledgeRefs
    )
    const editedBranch = replaceUserMessageBranch(conversation, messageId, editedMessage)
    if (!editedBranch) return
    const { messages: nextMessages, projectMemory } = editedBranch
    const firstUserMessage = nextMessages.find((message) => message.role === 'user')
    const nextConversation: Conversation = {
      ...conversation,
      title: firstUserMessage
        ? t('quickChat.conversationTitle', { text: firstUserMessage.content.slice(0, 18) })
        : conversation.title,
      messages: nextMessages,
      projectMemory,
      modelProviderId: selectedProvider.id,
      modelId: selectedProvider.defaultModel,
      reasoningEffort: selectedReasoningEffort,
      totalTokens: nextMessages.reduce((sum, message) => sum + (message.tokenCount ?? 0), 0),
      totalInputTokens: nextMessages.reduce((sum, message) => sum + (message.inputTokens ?? 0), 0),
      totalOutputTokens: nextMessages.reduce((sum, message) => sum + (message.outputTokens ?? 0), 0),
      updatedAt: Date.now()
    }

    cancelQuickMessageEdit()
    setStatus('')
    beginQuickResponse()
    setMessageAutoFollow(true)
    streamingConversationIdRef.current = nextConversation.id
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    if (usesWorkspaceAgent(nextConversation)) {
      void executeQuickWorkspaceConversation(nextConversation, nextConversation.workspace)
      return
    }
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant,
      assistantMemories,
      assistantSkills,
      provider: selectedProvider,
      messages: nextConversation.messages,
      settings,
      reasoningEffort: nextConversation.reasoningEffort,
      ...getQuickWebSearchRequestSettings(webSearchMode, nextConversation)
    })
  }

  async function launchQuickGoalFromAssessment(
    baseConversation: Conversation,
    workspace: ConversationWorkspace,
    result: GoalAssessResult,
    assumptions: string[]
  ) {
    if (!settings) return
    const now = Date.now()
    const goal = result.goal.trim() || baseConversation.goalDraft?.latestInput || ''
    if (!goal) return
    const criteria = result.acceptanceCriteria.trim() || t('goalMode.inferAcceptance')
    const goalTask: GoalTask = {
      id: createId('goal'),
      goal,
      acceptanceCriteria: criteria,
      status: 'running',
      contextMode: 'auto',
      resolvedContextMode: resolveGoalContextMode('auto', goal, criteria, baseConversation.goalTask, baseConversation.messages),
      assumptions,
      runCount: 1,
      startedAt: now,
      lastRunStartedAt: now,
      updatedAt: now
    }
    const goalMessage = createMessage('user', t('goalMode.executionPrompt', { goal, criteria }))
    goalTask.contextStartMessageId = goalMessage.id
    const nextConversation: Conversation = {
      ...baseConversation,
      workspace,
      goalTask,
      goalDraft: undefined,
      title: baseConversation.messages.length === 0 ? goal.slice(0, 28) : baseConversation.title,
      messages: [...baseConversation.messages, goalMessage],
      modelProviderId: selectedProvider.id,
      modelId: selectedProvider.defaultModel,
      reasoningEffort: selectedReasoningEffort,
      updatedAt: now
    }
    setGoalModeArmed(false)
    setDraft('')
    setDraftWorkspace(undefined)
    setStatus('')
    beginQuickResponse(now)
    streamingConversationIdRef.current = nextConversation.id
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    if (assumptions.length > 0) setStatus(t('goalMode.launchedWithAssumptions', { count: assumptions.length }))
    await executeQuickWorkspaceConversation(nextConversation, workspace)
  }

  async function runQuickGoalFlow(
    nextConversation: Conversation,
    workspace: ConversationWorkspace,
    userText: string
  ) {
    if (!settings) return
    const token = ++goalFlowTokenRef.current
    const priorDraft = nextConversation.goalDraft
    const round = priorDraft?.status === 'clarifying' ? priorDraft.round + 1 : 0
    const askedQuestions = Array.from(new Set([
      ...(priorDraft?.askedQuestions ?? []),
      ...(priorDraft?.questions ?? [])
    ].map((question) => question.trim()).filter(Boolean)))
    setGoalAssessing(true)
    goalAssessingRef.current = true
    let launched = false
    try {
      const result = await window.gllm.assessGoal({
        provider: selectedProvider,
        settings,
        messages: nextConversation.messages,
        latestInput: userText,
        round,
        alreadyAsked: askedQuestions,
        language: settings.language
      })
      if (token !== goalFlowTokenRef.current) return
      const assumptions = [...(result.assumptions ?? [])]
      if (result.error) assumptions.push(t('goalMode.assessmentFallback'))
      if (result.sufficient || result.error) {
        launched = true
        await launchQuickGoalFromAssessment(nextConversation, workspace, result, assumptions)
        return
      }
      const choices = result.choices ?? []
      const questions = result.questions.length > 0 ? result.questions : (choices.length > 0 ? [] : [t('goalMode.clarifyGeneric')])
      const clarificationText = [
        t('goalMode.clarifyIntro'),
        ...questions.map((question, index) => `${index + 1}. ${question}`),
        ...choices.map((choice) => `• ${choice.text}${choice.options.length ? `（${choice.options.join(' / ')}）` : ''}`)
      ].filter(Boolean).join('\n')
      const assistantMessage = createMessage('assistant', clarificationText)
      const draft: GoalDraft = {
        status: 'clarifying',
        latestInput: userText,
        goal: result.goal || userText,
        acceptanceCriteria: result.acceptanceCriteria,
        scope: result.scope,
        constraints: result.constraints,
        questions,
        choices,
        askedQuestions: Array.from(new Set([...askedQuestions, ...questions, ...choices.map((choice) => choice.text)])),
        round,
        assumptions: result.assumptions,
        changed: result.changed,
        updatedAt: Date.now()
      }
      const updated: Conversation = {
        ...nextConversation,
        goalDraft: draft,
        messages: [...nextConversation.messages, assistantMessage],
        updatedAt: Date.now()
      }
      setConversation(updated)
      setConversations((current) => [updated, ...current.filter((item) => item.id !== updated.id)])
      conversationRef.current = updated
      void window.gllm.saveConversation(updated)
      setStatus(t('goalMode.clarifyingNotice'))
    } catch (error) {
      if (token !== goalFlowTokenRef.current) return
      launched = true
      const fallback: GoalAssessResult = {
        sufficient: true,
        goal: userText,
        acceptanceCriteria: '',
        questions: [],
        assumptions: [],
        changed: false,
        error: error instanceof Error ? error.message : String(error)
      }
      await launchQuickGoalFromAssessment(nextConversation, workspace, fallback, [t('goalMode.assessmentFallback')])
    } finally {
      setGoalAssessing(false)
      goalAssessingRef.current = false
      if (!launched && token === goalFlowTokenRef.current) {
        streamingConversationIdRef.current = null
        responseStartedAtRef.current = null
        updateStreaming(false)
      }
    }
  }

  function cancelQuickGoalMode() {
    if (goalAssessingRef.current) {
      streamingConversationIdRef.current = null
      responseStartedAtRef.current = null
      updateStreaming(false)
    }
    goalFlowTokenRef.current += 1
    setGoalModeArmed(false)
    setGoalAssessing(false)
    goalAssessingRef.current = false
    const current = conversationRef.current
    if (current?.goalDraft) {
      const updated: Conversation = { ...current, goalDraft: undefined, updatedAt: Date.now() }
      setConversation(updated)
      setConversations((items) => [updated, ...items.filter((item) => item.id !== updated.id)])
      conversationRef.current = updated
      void window.gllm.saveConversation(updated)
    }
    setStatus(t('goalMode.modeCancelled'))
  }

  function answerQuickGoalChoice(choice: GoalChoice, selection: string[]) {
    if (selection.length === 0) return
    const answer = selection.length === 1
      ? t('goalMode.choiceAnswer', { question: choice.text, option: selection[0] })
      : t('goalMode.choiceAnswerMulti', { question: choice.text, options: selection.join('、') })
    void sendMessage(answer)
  }

  function focusQuickComposerInput() {
    draftTextareaRef.current?.focus()
  }

  async function sendMessage(content = draft) {
    if (!settings || isPickingAttachment || preparingWorkspaceRef.current || isStreamingRef.current) return
    flushComposerDraftPersist(quickDraftStorageKey)
    if (getSkillInstallIntent(content)) {
      await installQuickConversationSkill(content.trim())
      return
    }
    if ((assistant.status ?? 'active') !== 'active') {
      setStatus(t('assistantSettings.inactiveNotice'))
      return
    }

    if (needsApiKey) {
      setStatus(missingProviderMessage)
      void openMainWindow()
      return
    }

    const text = content.trim()
    if (!text && pendingQuoteRefs.length === 0 && pendingAttachments.length === 0) return
    const messageText = text || (pendingQuoteRefs.length > 0
      ? t('quickChat.answerWithQuote')
      : pendingAttachments.some((attachment) => attachment.kind === 'image')
        ? t('quickChat.analyzeImage')
        : t('quickChat.analyzeAttachment'))

    const baseConversation = conversation ?? createQuickConversation(
      assistant,
      t('quickChat.conversationTitle', { text: messageText.slice(0, 18) }),
      activeProjectId || undefined
    )
    let requestWorkspace = currentWorkspace
    if (!requestWorkspace) {
      preparingWorkspaceRef.current = true
      try { requestWorkspace = await window.gllm.ensureConversationWorkspace(baseConversation.id, baseConversation.projectId) }
      catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return }
      finally { preparingWorkspaceRef.current = false }
    }
    let imported = pendingAttachments
    preparingWorkspaceRef.current = true
    try { if (imported.length) imported = await window.gllm.importWorkspaceAttachments(requestWorkspace.rootPath, imported) }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return }
    finally { preparingWorkspaceRef.current = false }
    const userMessage = createMessage('user', messageText, imported, pendingQuoteRefs)
    const nextConversation: Conversation = {
      ...baseConversation,
      workspace: requestWorkspace,
      title: baseConversation.messages.length === 0
        ? t('quickChat.conversationTitle', { text: messageText.slice(0, 18) })
        : baseConversation.title,
      messages: [...baseConversation.messages, userMessage],
      modelProviderId: selectedProvider.id,
      modelId: selectedProvider.defaultModel,
      reasoningEffort: selectedReasoningEffort,
      webSearchMode,
      updatedAt: Date.now()
    }

    setDraft('')
    setPendingQuoteRefs([])
    setPendingAttachments([])
    setStatus('')
    beginQuickResponse(userMessage.createdAt)
    streamingConversationIdRef.current = nextConversation.id
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    if (goalModeArmed || nextConversation.goalDraft?.status === 'clarifying') {
      if (!conversation) setDraftWorkspace(undefined)
      await runQuickGoalFlow(nextConversation, requestWorkspace, messageText)
      return
    }
    if (usesWorkspaceAgent(nextConversation)) {
      if (!conversation) setDraftWorkspace(undefined)
      void executeQuickWorkspaceConversation(nextConversation, nextConversation.workspace)
      return
    }
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant,
      assistantMemories,
      assistantSkills,
      provider: selectedProvider,
      messages: nextConversation.messages,
      settings,
      reasoningEffort: nextConversation.reasoningEffort,
      ...getQuickWebSearchRequestSettings(webSearchMode, nextConversation)
    })
  }

  async function installQuickConversationSkill(content: string) {
    const base = conversation ?? createQuickConversation(assistant, content.slice(0, 28), activeProjectId || undefined)
    const pending = prepareSkillInstallationConversation({
      ...base, workspace: currentWorkspace,
      title: base.messages.length ? base.title : content.slice(0, 28),
      messages: [...base.messages, createMessage('user', content, pendingAttachments, pendingQuoteRefs)]
    })
    skillInstallationRef.current = pending
    const updateConversation = (next: Conversation) => {
      if (next.projectId !== activeProjectIdRef.current) return
      setConversations((current) => [next, ...current.filter((item) => item.id !== next.id)])
      if (conversationRef.current?.id === pending.id) {
        setConversation(next)
        conversationRef.current = next
      }
    }
    setConversation(pending)
    conversationRef.current = pending
    setConversations((current) => [pending, ...current.filter((item) => item.id !== pending.id)])
    setDraft('')
    setPendingAttachments([])
    setPendingQuoteRefs([])
    setStatus('')
    beginQuickResponse()
    streamingConversationIdRef.current = pending.id
    try {
      const result = await window.gllm.installSkillFromConversation(pending)
      if (result.capabilities.projectId === activeProjectIdRef.current) {
        setAssistants(result.capabilities.assistants)
        setSkills(result.capabilities.skills)
      }
      updateConversation(result.conversation)
    } catch (error) {
      updateConversation(await saveSkillInstallationFailure(pending, error))
    } finally {
      skillInstallationRef.current = null
      if (streamingConversationIdRef.current === pending.id) {
        streamingConversationIdRef.current = null
        responseStartedAtRef.current = null
        updateStreaming(false)
      }
    }
  }

  function stopGenerating() {
    if (!isStreaming || !conversation) return
    if (skillInstallationRef.current?.id === conversation.id) {
      window.gllm.cancelResponse(conversation.id)
      return
    }
    window.gllm.cancelResponse(conversation.id)
    const stoppedWebSearchConversation = stopConversationWebSearch(conversation)
    const lastAssistantIndex = stoppedWebSearchConversation.messages.findLastIndex((message) => message.role === 'assistant')
    const stoppedConversation = lastAssistantIndex >= 0
      ? {
          ...stoppedWebSearchConversation,
          messages: stoppedWebSearchConversation.messages.map((message, index) => index === lastAssistantIndex
            ? {
                ...message,
                responseStartedAt: message.responseStartedAt ?? responseStartedAtRef.current ?? undefined,
                responseCompletedAt: message.responseCompletedAt ?? Date.now()
              }
            : message),
          updatedAt: Date.now()
        }
      : stoppedWebSearchConversation
    const finalConversation: Conversation = stoppedConversation.goalTask
      ? {
          ...stoppedConversation,
          goalTask: {
            ...stoppedConversation.goalTask,
            status: 'paused',
            updatedAt: Date.now()
          }
        }
      : stoppedConversation
    setConversation(finalConversation)
    setConversations((current) => current.map((item) => item.id === finalConversation.id ? finalConversation : item))
    conversationRef.current = finalConversation
    void window.gllm.saveConversation(finalConversation)
    streamingConversationIdRef.current = null
    responseStartedAtRef.current = null
    updateStreaming(false)
    if (finalConversation.goalTask) setStatus(t('goalMode.pausedNotice'))
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSendMessageFromKeyboard(event, messageSendShortcut)) return
    event.preventDefault()
    sendMessage()
  }

  function getMessageSelectionForMessage(messageId: string): MessageSelectionSnapshot | null {
    return getMessageSelectionSnapshot(document.querySelector(`[data-message-id="${messageId}"]`))
  }

  function openSelectionContextMenu(event: ReactMouseEvent, message: ChatMessage) {
    if (openRenderedImageMenu(event)) return

    const selection = getMessageSelectionForMessage(message.id)
    const text = selection?.text || message.content.trim()
    if (!text) {
      setSelectionMenu(null)
      return
    }

    event.preventDefault()
    setSelectionMenu({
      x: Math.min(event.clientX, window.innerWidth - 164),
      y: Math.min(event.clientY, window.innerHeight - 96),
      text,
      html: selection?.html ?? '',
      source: selection ? 'selection' : 'message'
    })
  }

  function openRenderedImageMenu(event: ReactMouseEvent): boolean {
    const target = event.target
    if (!(target instanceof HTMLImageElement)) return false

    const source = target.currentSrc || target.src
    if (!source) return false

    event.preventDefault()
    event.stopPropagation()
    setSelectionMenu(null)
    setRenderedImageMenu({
      x: Math.min(event.clientX, window.innerWidth - 174),
      y: Math.min(event.clientY, window.innerHeight - 58),
      source,
      suggestedName: target.alt || undefined
    })
    return true
  }

  async function saveRenderedImageAs() {
    const image = renderedImageMenu
    if (!image) return

    setRenderedImageMenu(null)
    try {
      const savedPath = await window.gllm.saveImageAs({ source: image.source, suggestedName: image.suggestedName })
      if (savedPath) setStatus(t('notices.imageSaved'))
    } catch {
      setStatus(t('notices.imageSaveFailed'))
    }
  }

  async function copySelectionMenuText() {
    if (!selectionMenu) return

    try {
      if (selectionMenu.source === 'selection') {
        await writeRichTextToClipboard(selectionMenu)
      } else {
        await writePlainTextToClipboard(selectionMenu.text)
      }
      setStatus(selectionMenu.source === 'selection' ? t('quickChat.copiedSelection') : t('quickChat.copiedMessage'))
    } catch {
      setStatus(t('quickChat.copyFailed'))
    } finally {
      setSelectionMenu(null)
    }
  }

  function addQuoteReference(content: string) {
    const trimmed = content.trim()
    if (!trimmed) return

    setPendingQuoteRefs((current) => [
      ...current,
      {
        id: `${quoteReferencePrefix}${createId('quick_quote')}`,
        title: t('quickChat.quoteTitle', { text: trimmed.length > 22 ? `${trimmed.slice(0, 22)}...` : trimmed }),
        content: trimmed
      }
    ].slice(-4))
    window.requestAnimationFrame(() => draftTextareaRef.current?.focus())
  }

  function removePendingQuoteRef(id: string) {
    setPendingQuoteRefs((current) => current.filter((reference) => reference.id !== id))
  }

  function quoteSelectionMenuText() {
    if (!selectionMenu) return

    addQuoteReference(selectionMenu.text)
    setStatus(selectionMenu.source === 'selection' ? t('quickChat.quotedSelection') : t('quickChat.quotedMessage'))
    setSelectionMenu(null)
  }

  async function copyQuickMessage(message: ChatMessage) {
    try {
      await writePlainTextToClipboard(message.content)
      setStatus(t('quickChat.copiedMessage'))
    } catch {
      setStatus(t('quickChat.copyFailed'))
    }
  }

  function quoteQuickMessage(message: ChatMessage) {
    addQuoteReference(message.content)
    setStatus(t('quickChat.quotedMessage'))
  }

  async function saveQuickMessageToNote(message: ChatMessage) {
    if (!conversation) return
    const content = message.content.trim()
    if (!content) return
    const now = Date.now()
    await window.gllm.saveNote({
      id: createId('note'),
      projectId: conversation.projectId,
      title: content.split('\n').find((line) => line.trim())?.trim().slice(0, 36) || t('notices.chatNote'),
      content,
      assistantId: assistant.id,
      conversationId: conversation.id,
      messageId: message.id,
      createdAt: now,
      updatedAt: now
    })
    setStatus(t('notices.savedToKnowledge'))
  }

  function deleteQuickMessage(messageId: string) {
    if (!conversation) return
    const nextMessages = conversation.messages.filter((message) => message.id !== messageId)
    const firstUserMessage = nextMessages.find((message) => message.role === 'user')
    const nextConversation: Conversation = {
      ...conversation,
      title: firstUserMessage?.content.slice(0, 28) || conversation.title,
      messages: nextMessages,
      totalTokens: nextMessages.reduce((sum, message) => sum + (message.tokenCount ?? 0), 0),
      updatedAt: Date.now()
    }
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    setStatus(t('notices.messageDeleted'))
  }

  return (
    <div className="quick-shell">
      <header className="quick-titlebar">
        <div className="quick-brand">
          <img src={logo} alt="G-LLM" />
          <div>
            <strong>{assistantDisplay.name}</strong>
            <span>{assistantDisplay.title} · {selectedProvider.name} · {selectedProvider.defaultModel}</span>
          </div>
        </div>
        <div className="quick-actions">
          <button title={t('quickChat.new')} type="button" onClick={startNewQuickChat}>
            <MessageSquarePlus size={17} />
          </button>
          <button
            aria-label={isWindows ? t('quickChat.minimizeAria') : t('quickChat.closeAria')}
            title={isWindows ? t('quickChat.minimize') : t('common.close')}
            type="button"
            onClick={() => void window.gllm.hideQuickPanel()}
          >
            {isWindows ? <Minus size={18} /> : <X size={18} />}
          </button>
          <button title={t('quickChat.openMain')} type="button" onClick={() => void openMainWindow()}>
            <ExternalLink size={17} />
          </button>
        </div>
      </header>

      <div className="quick-message-viewport">
      <main className={`quick-content ${isWindows ? 'windows-scrollbar' : ''}`} ref={messagesRef} onScroll={updateMessageScrollState} onWheel={handleMessageWheel}>
        <GllmAccountPanel provider={selectedProvider} compact onManualConfiguration={() => void openMainWindow()} />
        {messages.length === 0 ? (
          <section className="quick-empty">
            <p><span>{t('quickChat.greeting')}</span></p>
            <h1>{t('quickChat.prompt', { assistant: assistantDisplay.name })}</h1>
            <div className="quick-starters">
              {assistantDisplay.starterPrompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => sendMessage(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        ) : (
          messages.map((message, messageIndex) => {
            const isEditing = editingMessageId === message.id
            const isMessageStreaming = Boolean(
              isStreaming &&
              messageIndex === messages.length - 1 &&
              message.role === 'assistant'
            )
            const isReasoningInProgress = Boolean(
              message.reasoningContent &&
              isMessageStreaming
            )
            const messageTimestamp = formatMessageTimestamp(
              message.createdAt,
              i18n.resolvedLanguage ?? 'zh-CN',
              settings?.timeZone
            )
            const messageTokens = getQuickMessageTokenUsage(message)
            return (
              <article
              key={message.id}
              className={`quick-message ${message.role} ${message.error ? 'message-error' : ''}`}
              data-message-id={message.id}
              onContextMenu={(event) => openSelectionContextMenu(event, message)}
            >
              <div className="quick-message-bubble">
                {message.webSearch && (
                  <WebSearchActivityCard
                    activity={message.webSearch}
                    model={selectedProvider.defaultModel}
                    running={isMessageStreaming && !message.content.trim() && !message.reasoningContent}
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
                        <MarkdownMessage content={message.reasoningContent} streaming />
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
                  <div className="message-edit-panel quick-message-edit-panel">
                    <textarea
                      autoFocus
                      aria-label={t('app.editMessage')}
                      value={editingMessageContent}
                      onChange={(event) => setEditingMessageContent(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          cancelQuickMessageEdit()
                        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault()
                          resendEditedQuickMessage(message.id)
                        }
                      }}
                    />
                    <small>{t('app.editMessageBranchHint')}</small>
                    <div className="message-edit-actions">
                      <button type="button" onClick={cancelQuickMessageEdit}>{t('common.cancel')}</button>
                      <button
                        className="primary"
                        disabled={!editingMessageContent.trim()}
                        type="button"
                        onClick={() => resendEditedQuickMessage(message.id)}
                      >
                        <Send size={13} />
                        {t('app.resendEditedMessage')}
                      </button>
                    </div>
                  </div>
                ) : (message.content.trim() || !message.webSearch) && (
                  <div className="quick-message-content markdown-body">
                    <MarkdownMessage
                      content={message.content || (message.role === 'assistant' ? t('app.thinking') : '')}
                      streaming={isMessageStreaming}
                    />
                  </div>
                )}
                {message.attachments && message.attachments.length > 0 && (
                  <div className="message-attachments quick-message-attachments">
                    {message.attachments.map((attachment) => (
                      <span key={attachment.id} className={`attachment-chip ${attachment.kind === 'image' && attachment.dataUrl ? 'image-chip' : ''}`}>
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
                {((message.workspaceActivities?.length ?? 0) > 0 || (message.workspaceChangedFiles?.length ?? 0) > 0 || message.agentPlan) && (
                  <WorkspaceActivityLog
                    activities={message.workspaceActivities ?? []}
                    plan={message.agentPlan}
                    changedFiles={message.workspaceChangedFiles}
                    artifactRoot={message.workspaceArtifactRoot}
                    onArtifactOpen={(rootPath, relativePath) => void window.gllm.revealWorkspaceFile(rootPath, relativePath)}
                  />
                )}
                {message.error && (
                  <ChatErrorRetry
                    error={message.error}
                    retryAt={messageIndex === messages.length - 1 ? message.retryAt : undefined}
                    disabled={isStreaming}
                    onRetry={() => retryMessage(message.id)}
                  />
                )}
              </div>
              {!isEditing && <div className="quick-message-footer">
                <div className="quick-message-actions" onMouseDown={(event) => event.preventDefault()}>
                  <button title={t('app.copyMarkdown')} type="button" onClick={() => void copyQuickMessage(message)}>
                    <Copy size={14} />
                  </button>
                  {message.role === 'user' && (
                    <button disabled={isStreaming} title={t('app.editAndResend')} type="button" onClick={() => editQuickMessage(message)}>
                      <Pencil size={14} />
                    </button>
                  )}
                  {message.role === 'assistant' && !message.error && (
                    <button disabled={isStreaming} title={t('app.regenerate')} type="button" onClick={() => retryMessage(message.id)}>
                      <RefreshCw size={14} />
                    </button>
                  )}
                  <button title={t('app.quoteMessage')} type="button" onClick={() => quoteQuickMessage(message)}>
                    <AtSign size={14} />
                  </button>
                  <button title={t('app.saveToKnowledge')} type="button" onClick={() => void saveQuickMessageToNote(message)}>
                    <NotebookPen size={14} />
                  </button>
                  <button title={t('common.delete')} type="button" onClick={() => deleteQuickMessage(message.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="quick-message-meta">
                  {message.role === 'assistant' && (
                    <ResponseDuration
                      completedAt={message.responseCompletedAt}
                      running={isMessageStreaming}
                      startedAt={message.responseStartedAt}
                    />
                  )}
                  <time dateTime={messageTimestamp.iso} title={messageTimestamp.full}>{messageTimestamp.short}</time>
                  <span
                    className="quick-message-token"
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
                      className="quick-message-context-saving"
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
            </article>
            )
          })
        )}
        {isStreaming && messages.at(-1)?.role === 'user' && (
          <article className="quick-message assistant">
            <div className={`quick-message-bubble ${currentWorkspace ? '' : 'quick-thinking'}`}>
              {currentWorkspace ? (
                <WorkspaceActivityLog
                  activities={workspaceActivities}
                  changedFiles={workspaceChangedFiles}
                  artifactRoot={currentWorkspace.rootPath}
                  model={selectedProvider.defaultModel}
                  onArtifactOpen={(rootPath, relativePath) => void window.gllm.revealWorkspaceFile(rootPath, relativePath)}
                  running
                />
              ) : (
                <ModelResponseWait model={selectedProvider.defaultModel} />
              )}
            </div>
          </article>
        )}
      </main>

      {messages.length > 0 && !isNearMessageBottom && (
        <button className="quick-scroll-latest-button" type="button" onClick={() => scrollToLatest('smooth')}>
          <ArrowDown size={15} />
          <span>{isStreaming ? t('app.aiResponding') : t('app.scrollLatest')}</span>
        </button>
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
      {renderedImageMenu && (
        <div
          className="selection-context-menu image-context-menu"
          style={{ left: renderedImageMenu.x, top: renderedImageMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => void saveRenderedImageAs()}>
            <Download size={15} />
            {t('app.saveImageAs')}
          </button>
        </div>
      )}
      {imagePreview && (
        <ImagePreviewDialog
          image={imagePreview}
          onClose={() => setImagePreview(null)}
          onImageContextMenu={openRenderedImageMenu}
        />
      )}

      {status && (
        <div className="quick-status">
          <span>{status}</span>
          <button type="button" onClick={() => setStatus('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {desktopSetupOpen && <DesktopAccessSetupDialog workspace={currentWorkspace} onClose={() => setDesktopSetupOpen(false)} onSave={saveDesktopWorkspace} />}
      {pendingWorkspaceRoot && (
        <WorkspaceApprovalDialog
          rootPath={pendingWorkspaceRoot}
          onCancel={() => setPendingWorkspaceRoot(null)}
          onSelect={(mode) => void confirmQuickWorkspace(mode)}
        />
      )}
      {workspaceInteraction && (!conversation || workspaceInteraction.conversationId === conversation.id) && (
        <WorkspaceInteractionDialog
          request={workspaceInteraction}
          onRespond={(response) => {
            window.gllm.respondWorkspaceInteraction(response)
            setWorkspaceInteraction(null)
          }}
          onCancel={() => {
            window.gllm.cancelWorkspaceInteraction(workspaceInteraction.id)
            setWorkspaceInteraction(null)
          }}
        />
      )}
      {currentWorkspace && workspaceApprovalPrompt && workspaceApprovalPrompt.conversationId === conversation?.id && (
        <WorkspaceOperationApprovalDialog
          prompt={workspaceApprovalPrompt}
          onRespond={(approved) => {
            window.gllm.respondWorkspaceApproval(workspaceApprovalPrompt.id, approved)
            setWorkspaceApprovalPrompt(null)
          }}
        />
      )}
      {goalSetupOpen && (
        <GoalSetupDialog
          currentWorkspace={currentWorkspace}
          defaultWebSearchMode={webSearchMode}
          initialGoal={draft}
          onChooseDirectory={chooseQuickGoalWorkspace}
          onClose={() => setGoalSetupOpen(false)}
          onStart={(value) => void startQuickGoalMode(value)}
        />
      )}

      <form
        className="quick-composer"
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
        onDrop={event => {
          const files = Array.from(event.dataTransfer.files)
          if (!files.length) return
          event.preventDefault(); event.stopPropagation()
          if (isPickingAttachment || isStreaming) return
          setIsPickingAttachment(true)
          void droppedFileInputs(files).then(inputs => window.gllm.preparePastedAttachments(inputs))
            .then(attachments => setPendingAttachments(current => [...current, ...attachments].slice(0, 8)))
            .catch(error => setStatus(String(error.message ?? error)))
            .finally(() => setIsPickingAttachment(false))
        }}
        onSubmit={(event) => {
          event.preventDefault()
          sendMessage()
        }}
      >
        {(goalModeArmed || goalAssessing || conversation?.goalDraft?.status === 'clarifying') && (
          <section className="goal-intake-status" aria-live="polite" role="status">
            <Target size={14} />
            <span className="goal-intake-text">
              {goalAssessing
                ? t('goalMode.assessing')
                : conversation?.goalDraft?.status === 'clarifying'
                  ? t('goalMode.clarifyingRound', { round: conversation.goalDraft.round + 1 })
                  : t('goalMode.armedHint')}
            </span>
            <button className="goal-intake-advanced" type="button" onClick={() => setGoalSetupOpen(true)} title={t('goalMode.advancedSetup')}>{t('goalMode.advancedSetup')}</button>
            <button className="goal-intake-cancel" type="button" onClick={cancelQuickGoalMode} title={t('goalMode.cancelMode')}><X size={14} /></button>
          </section>
        )}
        {conversation?.goalDraft?.status === 'clarifying' && (conversation.goalDraft.choices?.length ?? 0) > 0 && (
          <GoalChoiceCards
            choices={conversation.goalDraft.choices ?? []}
            disabled={goalAssessing || isStreaming}
            onAnswer={answerQuickGoalChoice}
            onCustom={focusQuickComposerInput}
          />
        )}
        {conversation?.pendingChoice && conversation.goalDraft?.status !== 'clarifying' && !isStreaming && conversation.messages.at(-1)?.role === 'assistant' && (
          <GoalChoiceCards
            choices={[{
              text: conversation.pendingChoice.prompt,
              options: conversation.pendingChoice.options,
              allowsCustom: true
            }]}
            disabled={isStreaming || goalAssessing}
            onAnswer={(choice, selection) => {
              if (selection.length === 0) return
              void sendMessage(t('goalMode.choiceAnswer', { question: choice.text, option: selection.join('、') }))
            }}
            onCustom={focusQuickComposerInput}
          />
        )}
        {conversation?.goalTask && (
          <GoalTaskPanel
            task={conversation.goalTask}
            running={isStreaming}
            onNewGoal={() => setGoalModeArmed(true)}
            onPause={() => setQuickGoalStatus('paused')}
            onResume={() => void resumeQuickGoal()}
            onClear={clearQuickGoal}
          />
        )}
        {!isStreaming && hasUnfinishedWorkspaceTask(conversation) && <WorkspaceResumeNotice onResume={resumeWorkspaceTask} onCancel={cancelQuickWorkspaceTask} />}
        {currentWorkspace && (
          <WorkspaceBar
            workspace={currentWorkspace}
            conversationId={conversation?.id}
            onOpen={() => void window.gllm.openWorkspaceDirectory(currentWorkspace.rootPath).catch((error) => {
              setStatus(error instanceof Error ? error.message : t('workspace.openDirectoryFailed'))
            })}
            onAgentSettingsChange={(settings) => changeQuickWorkspaceApproval(currentWorkspace.approvalMode ?? 'ask', settings)}
            running={isStreaming}
            onUnbind={() => void unbindQuickWorkspace()}
          />
        )}
        {pendingQuoteRefs.length > 0 && (
          <div className="quick-composer-quote-cards composer-quote-cards">
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
          <div className="quick-composer-attachments composer-attachments">
            {pendingAttachments.map((attachment) => (
              <span
                key={attachment.id}
                className={`attachment-chip ${attachment.kind === 'image' && attachment.dataUrl ? 'image-chip' : ''}`}
                title={attachment.name}
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
                <button onClick={() => removePendingAttachment(attachment.id)} title={t('app.removeAttachment')} type="button">
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="quick-composer-input-row composer-input-row">
          <textarea
            ref={draftTextareaRef}
            value={draft}
            disabled={!settings}
            rows={1}
            placeholder={needsApiKey ? (isManagedGllmProvider(selectedProvider) ? t('account.signInFirst') : t('app.configureApiKey')) : t('app.inputPlaceholder')}
            onChange={(event) => {
              setDraft(event.target.value)
              persistComposerDraft(quickDraftStorageKey, event.target.value)
            }}
            onPaste={(event) => void handleQuickPaste(event)}
            onKeyDown={handleDraftKeyDown}
          />
        </div>
        <div className="quick-composer-toolbar composer-toolbar">
          <div className="quick-composer-tools composer-tools">
            <button
              className={pendingAttachments.length > 0 ? 'active' : ''}
              disabled={isPickingAttachment}
              title={t('app.uploadAttachment')}
              type="button"
              onClick={() => void pickQuickAttachments('file')}
            >
              <Paperclip size={16} />
            </button>
            <button disabled={isPickingAttachment} title={t('app.captureScreenshot')} type="button" onClick={() => void captureQuickScreenshot()}>
              <ImagePlus size={16} />
            </button>
            <button
              className={currentWorkspace ? 'active' : ''}
              title={t('quickChat.workspace')}
              type="button"
              onClick={() => void openMainWindow()}
            >
              <FolderOpen size={16} />
            </button>
            <button aria-label={t('workspace.desktopAccess')} title={t('workspace.desktopAccess')} disabled={isStreaming} className={currentWorkspace?.computerAccess || currentWorkspace?.browserAccess || currentWorkspace?.computerWindowAccess || currentWorkspace?.browserWindowAccess ? 'active' : ''} type="button" onClick={() => setDesktopSetupOpen(true)}><MonitorCog size={16} /></button>
            <button
              className={goalModeArmed || goalSetupOpen || Boolean(conversation?.goalDraft) || Boolean(conversation?.goalTask) ? 'active' : ''}
              disabled={isStreaming}
              title={t('goalMode.title')}
              type="button"
              onClick={() => {
                if (goalModeArmed || conversation?.goalDraft?.status === 'clarifying') cancelQuickGoalMode()
                else setGoalModeArmed(true)
              }}
            >
              <Target size={16} />
            </button>
            <button title={t('quickChat.knowledge')} type="button" onClick={() => void openMainWindow()}>
              <BookOpen size={16} />
            </button>
            <WebSearchModePicker
              disabled={isStreaming}
              mode={webSearchMode}
              onChange={changeWebSearchMode}
            />
            <AgentPermissionPicker
              acknowledged={settings?.fullAccessAcknowledged ?? false}
              disabled={!settings}
              mode={effectivePermissionMode}
              onAcknowledge={() => void acknowledgeQuickFullAccess()}
              onChange={(mode) => void changeQuickPermissionMode(mode)}
            />
            <button title={t('quickChat.tools')} type="button" onClick={() => void openMainWindow()}>
              <Wrench size={16} />
            </button>
          </div>
          <div className="quick-composer-input-actions composer-input-actions">
          <ModelPickerMenu
            className="quick-model-picker composer-model-picker"
            compactTrigger
            provider={provider}
            value={activeModelId}
            variant="dropdown"
            placement="top"
            disabled={!settings || isStreaming}
            busy={isStreaming}
            showTriggerCapabilities={false}
            reasoningEffort={selectedReasoningEffort}
            onReasoningEffortChange={changeReasoningEffort}
            onModelReasoningChange={changeModelAndReasoning}
            onChange={changeModel}
          />
          <button
            className={`quick-send-button send-button${isStreaming ? ' stop' : ''}`}
            disabled={!settings || (!isStreaming && (isPickingAttachment || (!draft.trim() && pendingQuoteRefs.length === 0 && pendingAttachments.length === 0)))}
            onClick={isStreaming ? stopGenerating : undefined}
            title={isStreaming ? t('app.stopGenerating') : t('app.send', { shortcut: messageSendShortcutLabel })}
            type={isStreaming ? 'button' : 'submit'}
          >
            {isStreaming ? <Square size={15} fill="currentColor" /> : <Send size={18} />}
          </button>
          </div>
        </div>
      </form>
    </div>
  )
}
