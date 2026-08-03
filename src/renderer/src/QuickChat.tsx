/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import {
  ArrowDown,
  ArrowUp,
  AtSign,
  BookOpen,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe2,
  ImagePlus,
  MessageSquarePlus,
  Minus,
  NotebookPen,
  Paperclip,
  RefreshCw,
  Square,
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
import {
  getMessageSelectionSnapshot,
  writePlainTextToClipboard,
  writeRichTextToClipboard,
  type MessageSelectionSnapshot
} from './clipboard'
import {
  persistComposerDraft,
  QUICK_COMPOSER_DRAFT_KEY,
  readComposerDraft,
  resizeComposerTextarea
} from './composerInput'
import { getMessageSendShortcutLabel, shouldSendMessageFromKeyboard } from './keyboard'
import { applyRendererLanguage } from './i18n'
import { localizeAssistant } from './localizedContent'
import { MarkdownMessage } from './MarkdownMessage'
import { getModelOptions, ModelPickerMenu } from './ModelPicker'
import { applyDocumentTheme } from './theme'
import { formatMessageTimestamp } from './timeZone'
import { WorkspaceActivityLog, WorkspaceApprovalDialog, WorkspaceBar, WorkspaceOperationApprovalDialog } from './WorkspaceBar'
import { DEFAULT_ASSISTANTS, getAssistantById } from '@shared/assistants'
import { DEFAULT_PROVIDER, getProviderById } from '@shared/providers'
import type {
  ApiProvider,
  AppSettings,
  AttachmentKind,
  Assistant,
  AssistantMemory,
  ChatChunk,
  ChatMessage,
  Conversation,
  ConversationWorkspace,
  KnowledgeReference,
  MessageRetryAttempt,
  PreparedAttachment,
  ReasoningEffort,
  WorkspaceApprovalPrompt,
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

function formatTokenUnit(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(value >= 10_000 ? 0 : 1))}K`
  return `${value}`
}

function getQuickMessageTokenUsage(message: ChatMessage) {
  const fallback = estimateTokenCount(message.content)
  const input = Math.max(0, Math.round(message.inputTokens ?? (message.role === 'user' ? fallback : 0)))
  const output = Math.max(0, Math.round(message.outputTokens ?? (message.role === 'assistant' ? fallback : 0)))
  const total = Math.max(0, Math.round(message.tokenCount ?? input + output))
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

function createQuickConversation(assistant: Assistant, title: string): Conversation {
  const now = Date.now()

  return {
    id: createId('conversation'),
    assistantId: assistant.id,
    title,
    messages: [],
    reasoningEffort: 'default',
    createdAt: now,
    updatedAt: now
  }
}

function applyChatChunk(conversation: Conversation, chunk: ChatChunk): Conversation {
  const messages = [...conversation.messages]
  const last = messages.at(-1)
  const errorPresentation = chunk.error ? getChatErrorPresentation(chunk.error) : undefined
  const nextContent = errorPresentation?.userMessage ?? chunk.content

  if (!nextContent && !chunk.webSearch && !chunk.usage) {
    return { ...conversation, updatedAt: Date.now() }
  }

  if (last?.role === 'assistant') {
    const content = chunk.error ? nextContent : `${last.content}${nextContent}`
    messages[messages.length - 1] = {
      ...last,
      content,
      error: errorPresentation?.technicalDetail ?? last.error,
      retryAt: errorPresentation?.automaticallyRetryable ? Date.now() + 60_000 : last.retryAt,
      webSearch: chunk.webSearch ?? last.webSearch,
      tokenCount: chunk.usage?.totalTokens ?? estimateTokenCount(content),
      inputTokens: chunk.usage?.inputTokens ?? last.inputTokens,
      outputTokens: chunk.usage?.outputTokens ?? estimateTokenCount(content)
    }
  } else {
    messages.push({
      ...createMessage('assistant', nextContent),
      error: errorPresentation?.technicalDetail,
      retryAt: errorPresentation?.automaticallyRetryable ? Date.now() + 60_000 : undefined,
      webSearch: chunk.webSearch,
      tokenCount: chunk.usage?.totalTokens ?? estimateTokenCount(nextContent),
      inputTokens: chunk.usage?.inputTokens ?? 0,
      outputTokens: chunk.usage?.outputTokens ?? estimateTokenCount(nextContent)
    })
  }

  return {
    ...conversation,
    messages,
    updatedAt: Date.now(),
    totalTokens: messages.reduce((sum, message) => sum + (message.tokenCount ?? 0), 0)
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
  const [providers, setProviders] = useState<ApiProvider[]>([DEFAULT_PROVIDER])
  const [assistants, setAssistants] = useState<Assistant[]>(DEFAULT_ASSISTANTS)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [memories, setMemories] = useState<AssistantMemory[]>([])
  const [activeAssistantId, setActiveAssistantId] = useState(DEFAULT_ASSISTANTS[0].id)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [selectedModelId, setSelectedModelId] = useState(DEFAULT_PROVIDER.defaultModel)
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort>('default')
  const [draft, setDraft] = useState(() => readComposerDraft(QUICK_COMPOSER_DRAFT_KEY))
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState('')
  const [selectionMenu, setSelectionMenu] = useState<SelectionContextMenu | null>(null)
  const [pendingQuoteRefs, setPendingQuoteRefs] = useState<KnowledgeReference[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<PreparedAttachment[]>([])
  const [isPickingAttachment, setIsPickingAttachment] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [draftWorkspace, setDraftWorkspace] = useState<ConversationWorkspace | undefined>()
  const [pendingWorkspaceRoot, setPendingWorkspaceRoot] = useState<string | null>(null)
  const [workspaceApprovalPrompt, setWorkspaceApprovalPrompt] = useState<WorkspaceApprovalPrompt | null>(null)
  const [workspaceActivities, setWorkspaceActivities] = useState<WorkspaceToolActivity[]>([])
  const [autoFollowMessages, setAutoFollowMessages] = useState(true)
  const [isNearMessageBottom, setIsNearMessageBottom] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null)
  const autoFollowMessagesRef = useRef(true)
  const conversationRef = useRef<Conversation | null>(null)
  const workspaceActivitiesRef = useRef<WorkspaceToolActivity[]>([])

  const assistant = useMemo(() => getAssistantById(activeAssistantId, assistants), [activeAssistantId, assistants])
  const assistantDisplay = useMemo(
    () => localizeAssistant(assistant),
    [assistant, i18n.resolvedLanguage]
  )
  const assistantMemories = useMemo(
    () => memories.filter((memory) => memory.assistantId === assistant.id && memory.enabled),
    [assistant.id, memories]
  )
  const provider = useMemo(
    () => {
      const providerId = conversation?.modelProviderId || assistant.modelProviderId || settings?.activeProviderId
      return providerId ? getProviderById(providerId, providers) : providers[0] ?? DEFAULT_PROVIDER
    },
    [assistant.modelProviderId, conversation?.modelProviderId, providers, settings]
  )
  const activeModelId = selectedModelId.trim() || provider.defaultModel
  const selectedProvider = useMemo(
    () => ({
      ...provider,
      defaultModel: activeModelId,
      models: getModelOptions(provider, activeModelId)
    }),
    [activeModelId, provider]
  )
  const needsApiKey = Boolean(settings && selectedProvider.requiresApiKey && !selectedProvider.apiKey.trim())
  const messageSendShortcut = settings?.messageSendShortcut ?? 'enter'
  const messageSendShortcutLabel = getMessageSendShortcutLabel(messageSendShortcut)
  const messages = conversation?.messages ?? []
  const currentWorkspace = conversation?.workspace ?? draftWorkspace

  useEffect(() => {
    void Promise.all([window.gllm.getState(), window.gllm.getActiveAssistantId()]).then(([state, activeId]) => {
      const loadedProviders = state.providers.length > 0 ? state.providers : [DEFAULT_PROVIDER]
      const visibleStateAssistants = state.assistants.filter((assistant) => !assistant.hidden)
      const loadedAssistants = visibleStateAssistants.length > 0 ? visibleStateAssistants : DEFAULT_ASSISTANTS
      const quickAssistant = getAssistantById(activeId, loadedAssistants)

      setSettings(state.settings)
      setProviders(loadedProviders)
      setAssistants(loadedAssistants)
      setConversations(state.conversations)
      setMemories(state.memories ?? [])
      setActiveAssistantId(quickAssistant.id)
      const latestConversation = getLatestAssistantConversation(state.conversations, quickAssistant.id)
      const initialProvider = state.settings
        ? getProviderById(latestConversation?.modelProviderId || quickAssistant.modelProviderId || state.settings.activeProviderId, loadedProviders)
        : loadedProviders[0] ?? DEFAULT_PROVIDER

      setConversation(latestConversation)
      setSelectedModelId(getQuickModelId(latestConversation, quickAssistant, initialProvider))
      setSelectedReasoningEffort(latestConversation?.reasoningEffort ?? 'default')
    })
  }, [])

  useEffect(() => {
    if (settings) applyDocumentTheme(settings.theme, true)
  }, [settings?.theme])

  useEffect(() => {
    if (settings) applyRendererLanguage(settings.language)
  }, [settings?.language])

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
    return window.gllm.onWorkspaceAgentProgress((progress) => {
      if (conversationRef.current?.id !== progress.conversationId) return
      setWorkspaceActivities((current) => {
        const index = current.findIndex((activity) => activity.id === progress.activity.id)
        const next = index >= 0
          ? current.map((activity, activityIndex) => activityIndex === index ? progress.activity : activity)
          : [...current, progress.activity]
        workspaceActivitiesRef.current = next
        return next
      })
    })
  }, [])

  useEffect(() => window.gllm.onWorkspaceApprovalRequested(setWorkspaceApprovalPrompt), [])

  useEffect(() => {
    persistComposerDraft(QUICK_COMPOSER_DRAFT_KEY, draft)
  }, [draft])

  useEffect(() => {
    resizeComposerTextarea(draftTextareaRef.current)
  }, [draft])

  useEffect(() => {
    if (!selectionMenu) return

    const closeMenu = () => setSelectionMenu(null)
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
  }, [selectionMenu])

  useEffect(() => {
    if (isStreaming) return
    setConversation(getLatestAssistantConversation(conversations, assistant.id))
  }, [assistant.id, conversations, isStreaming])

  useEffect(() => {
    setSelectedModelId(getQuickModelId(conversation, assistant, provider))
  }, [assistant, conversation?.id, conversation?.modelId, conversation?.modelProviderId, provider])

  useEffect(() => {
    setSelectedReasoningEffort(conversation?.reasoningEffort ?? 'default')
  }, [conversation?.id, conversation?.reasoningEffort])

  useEffect(() => {
    return window.gllm.onConversationChanged((change) => {
      setConversations(change.conversations)
      setConversation((current) => {
        if (change.action === 'metadata') {
          return current
            ? change.conversations.find((item) => item.id === current.id) ?? current
            : current
        }
        if (change.action === 'deleted' && current?.id === change.conversationId) {
          return getLatestAssistantConversation(change.conversations, assistant.id)
        }

        const updated = change.conversations.find((item) => item.id === (current?.id ?? change.conversationId))
        if (updated) return updated

        if (!current || current.id === change.conversationId) {
          return getLatestAssistantConversation(change.conversations, assistant.id)
        }

        return current
      })
    })
  }, [assistant.id])

  useEffect(() => {
    conversationRef.current = conversation
  }, [conversation])

  useEffect(() => {
    setMessageAutoFollow(true)
    setIsNearMessageBottom(true)
    setDraftWorkspace(undefined)
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    window.requestAnimationFrame(() => scrollToLatest('auto', { resumeAutoFollow: true }))
  }, [conversation?.id])

  useEffect(() => {
    const unsubscribe = window.gllm.onChatChunk((chunk) => {
      const current = conversationRef.current
      if (!current || current.id !== chunk.conversationId) return

      setConversation((active) => {
        if (!active || active.id !== chunk.conversationId) return active
        const next = applyChatChunk(active, chunk)
        conversationRef.current = next
        setConversations((current) => [next, ...current.filter((item) => item.id !== next.id)])
        if (chunk.done) void window.gllm.saveConversation(next)
        return next
      })

      if (chunk.done) {
        setIsStreaming(false)
        if (chunk.error) {
          setStatus(getChatErrorPresentation(chunk.error).userMessage)
        } else if (chunk.warning) {
          setStatus(chunk.warning)
        }
      }
    })

    return unsubscribe
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
    await window.gllm.showMainWindow()
    await window.gllm.hideQuickPanel()
  }

  function startNewQuickChat() {
    setConversation(null)
    setDraftWorkspace(undefined)
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    setDraft('')
    setPendingQuoteRefs([])
    setPendingAttachments([])
    setStatus('')
  }

  async function bindQuickWorkspace() {
    try {
      const rootPath = await window.gllm.chooseWorkspaceDirectory()
      if (!rootPath) return
      const normalizePath = (path: string) => {
        const normalized = path.replace(/[\\/]+$/, '').replace(/\\/g, '/')
        return window.gllm.platform === 'linux' ? normalized : normalized.toLocaleLowerCase()
      }
      const conflict = conversations.find((item) =>
        item.id !== conversation?.id &&
        item.workspace?.permission === 'read-write' &&
        normalizePath(item.workspace.rootPath) === normalizePath(rootPath)
      )
      if (conflict) {
        setStatus(t('workspace.folderConflict', { conversation: conflict.title }))
        return
      }
      setPendingWorkspaceRoot(rootPath)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('workspace.bindFailed'))
    }
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

  async function changeQuickWorkspaceApproval(approvalMode: NonNullable<ConversationWorkspace['approvalMode']>) {
    if (!currentWorkspace) return
    const workspace = { ...currentWorkspace, approvalMode, lastVerifiedAt: Date.now() }
    if (!conversation) {
      setDraftWorkspace(workspace)
      return
    }
    const nextConversation = { ...conversation, workspace, updatedAt: Date.now() }
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    await window.gllm.saveConversation(nextConversation)
  }

  async function unbindQuickWorkspace() {
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    if (!conversation) {
      setDraftWorkspace(undefined)
      return
    }
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

  async function executeQuickWorkspaceConversation(
    nextConversation: Conversation,
    workspace: ConversationWorkspace,
    retryAttempts: MessageRetryAttempt[] = []
  ) {
    if (!settings) return
    setWorkspaceActivities([])
    workspaceActivitiesRef.current = []
    try {
      const result = await window.gllm.runWorkspaceAgent({
        conversationId: nextConversation.id,
        workspace,
        provider: selectedProvider,
        messages: nextConversation.messages,
        settings,
        reasoningEffort: nextConversation.reasoningEffort,
        projectMemory: nextConversation.projectMemory
      })
      const assistantMessage: ChatMessage = {
        ...createMessage('assistant', result.content),
        workspaceActivities: result.activities,
        workspaceChangedFiles: result.changedFiles,
        workspaceArtifactRoot: workspace.rootPath,
        retryAttempts: retryAttempts.length > 0 ? retryAttempts : undefined
      }
      const nextMessages = [...nextConversation.messages, assistantMessage]
      const completedConversation: Conversation = {
        ...nextConversation,
        workspace,
        messages: nextMessages,
        totalTokens: nextMessages.reduce((sum, message) => sum + (message.tokenCount ?? 0), 0),
        updatedAt: Date.now()
      }
      setConversation(completedConversation)
      setConversations((current) => [completedConversation, ...current.filter((item) => item.id !== completedConversation.id)])
      conversationRef.current = completedConversation
      await window.gllm.saveConversation(completedConversation)
      if (result.changedFiles.length > 0) setStatus(t('workspace.filesChanged', { count: result.changedFiles.length }))
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : t('workspaceErrors.unknown')
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
        error: message,
        workspaceActivities: workspaceActivitiesRef.current,
        workspaceArtifactRoot: workspace.rootPath,
        retryAttempts: [...retryAttempts, attempt]
      }
      const nextMessages = [...nextConversation.messages, failedMessage]
      const failedConversation: Conversation = {
        ...nextConversation,
        workspace,
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
      setIsStreaming(false)
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

  function changeReasoningEffort(reasoningEffort: ReasoningEffort) {
    setSelectedReasoningEffort(reasoningEffort)
    if (!conversation || conversation.reasoningEffort === reasoningEffort) return

    const nextConversation: Conversation = {
      ...conversation,
      reasoningEffort,
      updatedAt: Date.now()
    }
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
  }

  function changeModelAndReasoning(modelId: string, reasoningEffort: ReasoningEffort) {
    setSelectedModelId(modelId)
    setSelectedReasoningEffort(reasoningEffort)
    if (!conversation) return

    const nextConversation: Conversation = {
      ...conversation,
      modelProviderId: provider.id,
      modelId,
      reasoningEffort,
      updatedAt: Date.now()
    }
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
  }

  function retryMessage(messageId: string) {
    if (!settings || isStreaming || !conversation) return

    if (needsApiKey) {
      setStatus(t('quickChat.configureProviderApiKey', { provider: selectedProvider.name }))
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
    setIsStreaming(true)
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    if (nextConversation.workspace) {
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
      provider: selectedProvider,
      messages: nextConversation.messages,
      settings,
      reasoningEffort: nextConversation.reasoningEffort,
      webSearchEnabled
    })
  }

  function sendMessage(content = draft) {
    if (!settings || isStreaming) return

    if (needsApiKey) {
      setStatus(t('quickChat.configureProviderApiKey', { provider: selectedProvider.name }))
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
      t('quickChat.conversationTitle', { text: messageText.slice(0, 18) })
    )
    const userMessage = createMessage('user', messageText, pendingAttachments, pendingQuoteRefs)
    const nextConversation: Conversation = {
      ...baseConversation,
      workspace: currentWorkspace,
      title: baseConversation.messages.length === 0
        ? t('quickChat.conversationTitle', { text: messageText.slice(0, 18) })
        : baseConversation.title,
      messages: [...baseConversation.messages, userMessage],
      modelProviderId: selectedProvider.id,
      modelId: selectedProvider.defaultModel,
      reasoningEffort: selectedReasoningEffort,
      updatedAt: Date.now()
    }

    setDraft('')
    setPendingQuoteRefs([])
    setPendingAttachments([])
    setStatus('')
    setIsStreaming(true)
    setConversation(nextConversation)
    setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== nextConversation.id)])
    conversationRef.current = nextConversation
    void window.gllm.saveConversation(nextConversation)
    if (currentWorkspace) {
      if (!conversation) setDraftWorkspace(undefined)
      void executeQuickWorkspaceConversation(nextConversation, currentWorkspace)
      return
    }
    window.gllm.streamChat({
      conversationId: nextConversation.id,
      assistant,
      assistantMemories,
      provider: selectedProvider,
      messages: nextConversation.messages,
      settings,
      reasoningEffort: nextConversation.reasoningEffort,
      webSearchEnabled
    })
  }

  function stopGenerating() {
    if (!isStreaming || !conversation) return
    window.gllm.cancelResponse(conversation.id)
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

      <main className="quick-content" ref={messagesRef} onScroll={updateMessageScrollState} onWheel={handleMessageWheel}>
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
                <MarkdownMessage content={message.content || (message.role === 'assistant' ? t('app.thinking') : '')} />
                {message.attachments && message.attachments.length > 0 && (
                  <div className="message-attachments quick-message-attachments">
                    {message.attachments.map((attachment) => (
                      <span key={attachment.id} className={`attachment-chip ${attachment.kind === 'image' && attachment.dataUrl ? 'image-chip' : ''}`}>
                        {attachment.kind === 'image' && attachment.dataUrl ? (
                          <img alt="" src={attachment.dataUrl} />
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
                {((message.workspaceActivities?.length ?? 0) > 0 || (message.workspaceChangedFiles?.length ?? 0) > 0) && (
                  <WorkspaceActivityLog
                    activities={message.workspaceActivities ?? []}
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
              <div className="quick-message-footer">
                <div className="quick-message-actions" onMouseDown={(event) => event.preventDefault()}>
                  <button title={t('app.copyMarkdown')} type="button" onClick={() => void copyQuickMessage(message)}>
                    <Copy size={14} />
                  </button>
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
                </div>
              </div>
            </article>
            )
          })
        )}
        {isStreaming && messages.at(-1)?.role === 'user' && (
          <article className="quick-message assistant">
            <div className={`quick-message-bubble ${currentWorkspace ? '' : 'quick-thinking'}`}>
              {currentWorkspace ? (
                <WorkspaceActivityLog activities={workspaceActivities} running />
              ) : (
                <><span /><span /><span /></>
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

      {status && (
        <div className="quick-status">
          <span>{status}</span>
          <button type="button" onClick={() => setStatus('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {pendingWorkspaceRoot && (
        <WorkspaceApprovalDialog
          rootPath={pendingWorkspaceRoot}
          onCancel={() => setPendingWorkspaceRoot(null)}
          onSelect={(mode) => void confirmQuickWorkspace(mode)}
        />
      )}
      {workspaceApprovalPrompt && (
        <WorkspaceOperationApprovalDialog
          prompt={workspaceApprovalPrompt}
          onRespond={(approved) => {
            window.gllm.respondWorkspaceApproval(workspaceApprovalPrompt.id, approved)
            setWorkspaceApprovalPrompt(null)
          }}
        />
      )}

      <form
        className="quick-composer"
        onSubmit={(event) => {
          event.preventDefault()
          sendMessage()
        }}
      >
        {currentWorkspace && (
          <WorkspaceBar
            workspace={currentWorkspace}
            onApprovalModeChange={(mode) => void changeQuickWorkspaceApproval(mode)}
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
                  <img alt="" src={attachment.dataUrl} />
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
        <div className="quick-composer-toolbar">
          <div className="quick-composer-tools">
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
              onClick={() => void bindQuickWorkspace()}
            >
              <FolderOpen size={16} />
            </button>
            <button title={t('quickChat.knowledge')} type="button" onClick={() => void openMainWindow()}>
              <BookOpen size={16} />
            </button>
            <button
              className={webSearchEnabled ? 'active' : ''}
              title={webSearchEnabled ? t('app.disableWebSearch') : t('app.enableWebSearch')}
              type="button"
              onClick={() => {
                setWebSearchEnabled((enabled) => {
                  setStatus(enabled ? t('app.webSearchDisabled') : t('app.webSearchEnabled'))
                  return !enabled
                })
              }}
            >
              <Globe2 size={16} />
            </button>
            <button title={t('quickChat.tools')} type="button" onClick={() => void openMainWindow()}>
              <Wrench size={16} />
            </button>
          </div>
        </div>
        <textarea
          ref={draftTextareaRef}
          value={draft}
          disabled={!settings}
          rows={1}
          placeholder={needsApiKey ? t('app.configureApiKey') : t('app.inputPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => void handleQuickPaste(event)}
          onKeyDown={handleDraftKeyDown}
        />
        <div className="quick-composer-input-actions">
          <ModelPickerMenu
            className="quick-model-picker"
            provider={provider}
            value={activeModelId}
            variant="dropdown"
            placement="top"
            disabled={!settings || isStreaming}
            showTriggerCapabilities={false}
            reasoningEffort={selectedReasoningEffort}
            onReasoningEffortChange={changeReasoningEffort}
            onModelReasoningChange={changeModelAndReasoning}
            onChange={setSelectedModelId}
          />
          <button
            className={`quick-send-button${isStreaming ? ' stop' : ''}`}
            disabled={!settings || (!isStreaming && !draft.trim() && pendingQuoteRefs.length === 0 && pendingAttachments.length === 0)}
            onClick={isStreaming ? stopGenerating : undefined}
            title={isStreaming ? t('app.stopGenerating') : t('app.send', { shortcut: messageSendShortcutLabel })}
            type={isStreaming ? 'button' : 'submit'}
          >
            {isStreaming ? <Square size={14} fill="currentColor" /> : <ArrowUp size={18} />}
          </button>
        </div>
      </form>
    </div>
  )
}
