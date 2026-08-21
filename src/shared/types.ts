/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export type Role = 'system' | 'user' | 'assistant'
export type MessageSendShortcut = 'enter' | 'ctrl-enter'
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high'
export type AppTheme = 'auto' | 'light' | 'dark' | 'gold'
export type FloatingMascotSkin = 'blue' | 'gold'
export type FloatingMascotAppearance = 'auto' | FloatingMascotSkin

export interface DeepLinkHandoffStatusEvent {
  status: 'success' | 'error'
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  reasoningContent?: string
  error?: string
  retryAt?: number
  attachments?: PreparedAttachment[]
  knowledgeRefs?: KnowledgeReference[]
  webSearch?: WebSearchActivity
  workspaceActivities?: WorkspaceToolActivity[]
  workspaceChangedFiles?: string[]
  workspaceArtifactRoot?: string
  retryAttempts?: MessageRetryAttempt[]
  translation?: string
  tokenCount?: number
  inputTokens?: number
  outputTokens?: number
  createdAt: number
}

export type AttachmentKind = 'file' | 'image'

export interface PreparedAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: AttachmentKind
  text?: string
  dataUrl?: string
  localExecutable?: boolean
}

export interface MessageRetryAttempt {
  attemptedAt: number
  error: string
  activities?: WorkspaceToolActivity[]
}

export type LocalTaskStatus = 'awaiting-approval' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'

export interface LocalTaskFilePlan {
  attachmentId: string
  name: string
  mimeType: string
  originalSize: number
  supported: boolean
  action: 'compress-image' | 'compress-pdf' | 'copy' | 'unsupported'
  warning?: string
}

export interface LocalTaskPlan {
  id: string
  request: string
  targetBytes: number
  targetLabel: string
  status: LocalTaskStatus
  files: LocalTaskFilePlan[]
  outputDirectoryName: string
  createdAt: number
}

export interface LocalTaskArtifact {
  attachmentId: string
  sourceName: string
  outputName?: string
  originalSize: number
  outputSize?: number
  outputPath?: string
  success: boolean
  verified: boolean
  message: string
}

export interface LocalTaskProgress {
  planId: string
  current: number
  total: number
  message: string
}

export interface LocalTaskResult {
  planId: string
  status: LocalTaskStatus
  targetBytes: number
  outputDirectory?: string
  artifacts: LocalTaskArtifact[]
  completedAt: number
}

export interface ClipboardAttachmentInput {
  name: string
  mimeType: string
  size: number
  kind?: AttachmentKind
  dataUrl?: string
  text?: string
}

export interface KnowledgeReference {
  id: string
  title: string
  content: string
}

export interface WebSearchResult {
  title: string
  url: string
  source?: string
  sourceDomain?: string
  snippet?: string
  excerpt?: string
  publishedAt?: number
  sourceRole?: 'specified' | 'primary' | 'independent' | 'community' | 'aggregator' | 'unknown'
  relevanceScore?: number
  clusterId?: string
}

export type WebResearchTaskType = 'lookup' | 'current' | 'compare' | 'evaluate' | 'verify' | 'explore'
export type WebResearchDepth = 'quick' | 'balanced' | 'deep'

export interface WebResearchConflict {
  topic: string
  summary: string
  sourceUrls: string[]
}

export interface WebResearchAudit {
  taskType: WebResearchTaskType
  depth: WebResearchDepth
  plannerMode: 'model' | 'fallback'
  plannerError?: string
  questions?: string[]
  candidateCount: number
  acceptedCount: number
  duplicateCount: number
  outdatedCount: number
  notApplicableCount: number
  lowRelevanceCount: number
  conflictCount: number
  coveredQuestionCount: number
  totalQuestionCount: number
  searchRounds: number
  contextCharacterBudget?: number
  searchEngines?: string[]
  unavailableSearchEngines?: string[]
  conflicts?: WebResearchConflict[]
}

export interface WebSearchActivity {
  status: 'planning' | 'searching' | 'completed' | 'failed'
  query: string
  intent?: string
  queries?: string[]
  activeQueries?: string[]
  completedQueries?: string[]
  results: WebSearchResult[]
  audit?: WebResearchAudit
  error?: string
  searchedAt?: number
}

export type AssistantIcon =
  | 'sparkles'
  | 'file'
  | 'scale'
  | 'code'
  | 'chart'
  | 'graduation'
  | 'brain'
  | 'briefcase'
  | 'pen'

export type AssistantColor = 'ink' | 'green' | 'amber' | 'blue' | 'rose' | 'teal' | 'violet' | 'slate'

export interface Assistant {
  id: string
  projectId?: string
  name: string
  title: string
  tone: string
  color: AssistantColor
  icon: AssistantIcon
  avatarDataUrl?: string
  systemPrompt: string
  starterPrompts: string[]
  modelProviderId?: string
  modelId?: string
  builtIn?: boolean
  hidden?: boolean
  pinnedAt?: number
  createdAt?: number
  updatedAt?: number
}

export interface Conversation {
  id: string
  projectId?: string
  assistantId: string
  title: string
  messages: ChatMessage[]
  modelProviderId?: string
  modelId?: string
  reasoningEffort?: ReasoningEffort
  workspace?: ConversationWorkspace
  projectMemory?: ConversationProjectMemory
  pinnedAt?: number
  totalTokens?: number
  totalInputTokens?: number
  totalOutputTokens?: number
  createdAt: number
  updatedAt: number
}

export interface ConversationSearchSource {
  conversationId: string
  projectId: string
  projectName: string
  assistantId: string
  assistantName: string
  title: string
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>
  createdAt: number
  updatedAt: number
}

export interface ConversationSearchRequest {
  query: string
  provider: ApiProvider
  limit?: number
}

export interface ConversationSearchResult {
  conversationId: string
  projectId: string
  projectName: string
  assistantId: string
  assistantName: string
  title: string
  snippet: string
  reason?: string
  score: number
  createdAt: number
  updatedAt: number
}

export interface ConversationSearchResponse {
  mode: 'recent' | 'local' | 'semantic'
  results: ConversationSearchResult[]
  searchedCount: number
}

export interface KnowledgeNote {
  id: string
  projectId?: string
  title: string
  content: string
  assistantId?: string
  conversationId?: string
  messageId?: string
  createdAt: number
  updatedAt: number
}

export interface AssistantMemory {
  id: string
  projectId?: string
  assistantId: string
  content: string
  enabled: boolean
  sourceNoteId?: string
  sourceMessageId?: string
  createdAt: number
  updatedAt: number
}

export type ToolConfigType = 'function' | 'mcp' | 'plugin'

export interface ToolConfig {
  id: string
  projectId?: string
  type: ToolConfigType
  name: string
  description?: string
  endpoint?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type ProviderTemplateId =
  | 'gllm'
  | 'openai-compatible'
  | 'openai'
  | 'google-gemini'
  | 'deepseek'
  | 'dashscope'
  | 'moonshot'
  | 'zhipu'
  | 'volcengine-ark'
  | 'siliconflow'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'together'
  | 'perplexity'
  | 'ollama'
  | 'lm-studio'
  | 'local-compatible'

export type ProviderTemplateCategory = 'default' | 'global' | 'china' | 'aggregator' | 'local'
export type ProviderModelType = 'chat' | 'vision' | 'image' | 'embedding' | 'audio' | 'rerank' | 'other'
export type ProviderModelCapability = ProviderModelType

export interface ProviderTemplate {
  id: ProviderTemplateId
  name: string
  description: string
  category: ProviderTemplateCategory
  apiBaseUrl: string
  chatCompletionsPath?: string
  imageGenerationsPath?: string
  modelsPath?: string
  defaultModel: string
  suggestedModels: string[]
  requiresApiKey: boolean
}

export interface ProviderModel {
  id: string
  name?: string
  ownedBy?: string
  capabilities?: ProviderModelCapability[]
  type?: ProviderModelType
}

export interface ApiProvider {
  id: string
  templateId: ProviderTemplateId
  name: string
  apiBaseUrl: string
  chatCompletionsPath?: string
  imageGenerationsPath?: string
  modelsPath?: string
  apiKey: string
  defaultModel: string
  models: ProviderModel[]
  modelsUpdatedAt?: number
  requiresApiKey: boolean
  createdAt?: number
  updatedAt?: number
}

export interface ProviderCheckResult {
  ok: boolean
  message: string
  models?: ProviderModel[]
}

export interface ThemeEntitlementResult {
  ok: boolean
  eligible: boolean
  reviewComplete: boolean
  message: string
  totalRequests: number
  officialRequests: number
  officialRequestRatio: number
}

export interface ThemeRequestUsage {
  totalRequests: number
  officialRequests: number
  updatedAt?: number
}

export interface Project {
  id: string
  name: string
  description?: string
  logoDataUrl?: string
  modelProviderId?: string
  modelId?: string
  workspacePath?: string
  workspacePermission?: 'read' | 'read-write'
  createdAt: number
  updatedAt: number
}

export interface ConversationProjectMemory {
  overview: string
  requirements: string[]
  decisions: string[]
  businessRules: string[]
  entities: string[]
  openItems: string[]
  risks: string[]
  updatedAt: number
  sourceMessageCount: number
}

export interface ConversationWorkspace {
  rootPath: string
  displayName: string
  permission: 'read' | 'read-write'
  approvalMode?: 'ask' | 'auto' | 'full'
  grantedAt: number
  lastVerifiedAt: number
}

export interface WorkspaceToolActivity {
  id: string
  tool: string
  label: string
  status: 'running' | 'completed' | 'failed'
  detail?: string
}

export interface WorkspaceApprovalPrompt {
  id: string
  conversationId: string
  purpose: string
  workspaceName: string
  canWrite: boolean
  isScript: boolean
}

export interface WorkspaceAgentRequest {
  conversationId: string
  workspace: ConversationWorkspace
  provider: ApiProvider
  messages: ChatMessage[]
  settings: AppSettings
  reasoningEffort?: ReasoningEffort
  projectMemory?: ConversationProjectMemory
}

export interface WorkspaceAgentProgress {
  conversationId: string
  activity: WorkspaceToolActivity
}

export interface WorkspaceAgentResult {
  conversationId: string
  content: string
  activities: WorkspaceToolActivity[]
  changedFiles: string[]
}

export interface AssistantSuggestion {
  name: string
  title: string
  tone: string
  color: AssistantColor
  icon: AssistantIcon
  systemPrompt: string
  starterPrompts: string[]
}

export interface AssistantSuggestionRequest {
  keyword: string
  provider: ApiProvider
  settings: AppSettings
}

export interface AppSettings {
  activeProviderId: string
  language: import('./i18n').AppLanguage
  timeZone: string
  theme: AppTheme
  temperature: number
  enableTemperature: boolean
  maxTokens: number
  enableMaxTokens: boolean
  messageSendShortcut: MessageSendShortcut
  floatingMascotSkin: FloatingMascotAppearance
  floatingMascotHints: boolean
  floatingMascotVisible: boolean
  telemetryEnabled: boolean
  setupCompleted: boolean
}

export interface DataLocationInfo {
  mode: 'normal' | 'portable'
  activePath: string
  defaultPath: string
  effectivePath: string
  customPath?: string
  locatorPath: string
  isCustom: boolean
  pendingRestart: boolean
}

export interface DataLocationChangeResult {
  info: DataLocationInfo
  changed: boolean
  restartRequired: boolean
  message: string
}

export interface DataArchiveResult {
  path: string
  message: string
  fileCount: number
  byteSize?: number
  backupPath?: string
  restartRequired?: boolean
}

export interface ChatRequest {
  conversationId: string
  assistant: Assistant
  assistantMemories?: AssistantMemory[]
  projectMemory?: ConversationProjectMemory
  provider: ApiProvider
  messages: ChatMessage[]
  settings: AppSettings
  reasoningEffort?: ReasoningEffort
  webSearchEnabled?: boolean
  purpose?: 'chat' | 'translation'
  targetMessageId?: string
}

export interface ChatChunk {
  conversationId: string
  content: string
  reasoningContent?: string
  webSearch?: WebSearchActivity
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  purpose?: 'chat' | 'translation'
  targetMessageId?: string
  done?: boolean
  error?: string
  warning?: string
  finishReason?: string
  isTruncated?: boolean
}

export interface ChatActivityEvent {
  conversationId: string
  active: boolean
  error?: string
}

export interface FloatingMascotHintEvent {
  message: string
  placement: 'left' | 'right'
  tone: 'idle' | 'success' | 'error'
}

export interface ConversationChangeEvent {
  action: 'saved' | 'deleted' | 'metadata'
  conversationId: string
  conversation?: Conversation
  conversations?: Conversation[]
}

export interface AppUpdateInfo {
  currentVersion: string
  latestVersion?: string
  updateAvailable: boolean
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'latest'
    | 'unavailable'
    | 'unsupported'
    | 'error'
  automaticUpdateSupported: boolean
  downloadPageUrl: string
  releaseNotes?: string
  updatedAt?: string
  downloadProgress?: number
  transferredBytes?: number
  totalBytes?: number
  message: string
}

export type LegalDocument = 'license' | 'third-party' | 'commercial' | 'trademarks'

export interface AppStateSnapshot {
  appVersion: string
  appBuildCode: string
  dataLocation: DataLocationInfo
  activeProjectId: string
  projects: Project[]
  settings: AppSettings
  providers: ApiProvider[]
  assistants: Assistant[]
  conversations: Conversation[]
  notes: KnowledgeNote[]
  memories: AssistantMemory[]
  tools: ToolConfig[]
}
