/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export type Role = 'system' | 'user' | 'assistant'
export type MessageSendShortcut = 'enter' | 'ctrl-enter'
export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high'
export type WebSearchMode = 'auto' | 'on' | 'off'
export type AppTheme = 'auto' | 'light' | 'dark' | 'gold'
export type FloatingMascotSkin = 'blue' | 'gold'
export type FloatingMascotAppearance = 'auto' | FloatingMascotSkin

export interface DeepLinkHandoffStatusEvent {
  status: 'idle' | 'waiting' | 'exchanging' | 'models' | 'success' | 'error' | 'cancelled' | 'expired'
  reason?: 'browser' | 'exchange' | 'storage' | 'models' | 'rateLimit'
  retryAt?: number
}

export type GllmAccountState = { status: 'ready'; remainingQuota: number; quotaPerUnit: number; checkedAt: number }
  | { status: 'rate-limited'; retryAt: number }
  | { status: 'disconnected' | 'credential-unavailable' | 'unauthorized' | 'unavailable' }

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
  agentPlan?: AgentExecutionPlan
  retryAttempts?: MessageRetryAttempt[]
  translation?: string
  tokenCount?: number
  inputTokens?: number
  outputTokens?: number
  contextSavings?: ContextSavings
  responseStartedAt?: number
  responseCompletedAt?: number
  createdAt: number
}

export interface ContextSavings {
  originalCharacters: number
  sentCharacters: number
  savedCharacters: number
  savedPercent: number
  compactedItems: number
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
  workspaceRelativePath?: string
  workspaceRootPath?: string
}

export interface WorkspaceFileEntry {
  name: string
  relativePath: string
  directory: boolean
  size: number
  modifiedAt: number
}

export interface ImageSaveRequest {
  source: string
  suggestedName?: string
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
  sourceTrust?: 'user-specified' | 'likely-official' | 'third-party' | 'unverified'
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
  status: 'planning' | 'searching' | 'completed' | 'failed' | 'stopped'
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

export type AssistantStatus = 'draft' | 'active' | 'paused'
export type AssistantConfigSourceType = 'built-in' | 'local' | 'workspace' | 'imported'

export interface AssistantConfigSource {
  type: AssistantConfigSourceType
  locator?: string
  version: string
}

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
  status?: AssistantStatus
  configSource?: AssistantConfigSource
  skillIds?: string[]
  toolIds?: string[]
  delegateAssistantIds?: string[]
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
  webSearchMode?: WebSearchMode
  workspace?: ConversationWorkspace
  goalTask?: GoalTask
  /** Lightweight conversational goal-draft state, used before a GoalTask is created. */
  goalDraft?: GoalDraft
  /**
   * A decision the assistant is waiting on, rendered as option cards above the
   * composer. Cleared as soon as the user answers.
   */
  pendingChoice?: PendingChoice
  projectMemory?: ConversationProjectMemory
  pinnedAt?: number
  totalTokens?: number
  totalInputTokens?: number
  totalOutputTokens?: number
  createdAt: number
  updatedAt: number
}

export interface MainConversationOpenRequest {
  conversationId: string
  projectId?: string
  assistantId?: string
}

export interface ComposerSessionTarget {
  conversationId?: string
  projectId?: string
  assistantId: string
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

export type GoalTaskStatus = 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
export type GoalWebSearchScope = 'all' | 'official' | 'specified'
export type GoalContextMode = 'auto' | 'continue' | 'relevant' | 'isolated'
export type ResolvedGoalContextMode = Exclude<GoalContextMode, 'auto'>

/**
 * A conversational goal draft. Created when the user sends a message in goal
 * mode; lives on the conversation so clarification Q&A survives restarts and
 * conversation switches. Once the LLM judges the requirement sufficient (or
 * the clarification round limit is reached), it is converted to a GoalTask and
 * removed.
 */
export interface GoalDraft {
  /** Which phase the draft is in. `ready` is a transient pre-launch state. */
  status: 'clarifying' | 'ready'
  /** The user's latest message that triggered or advanced this draft. */
  latestInput: string
  /** LLM-refined goal statement. */
  goal: string
  /** LLM-refined, verifiable acceptance criteria. */
  acceptanceCriteria: string
  /** Optional scope and constraints inferred from the conversation. */
  scope?: string
  constraints?: string
  /** The clarifying questions last shown to the user (already answered or pending). */
  questions: string[]
  /** Every question asked across all rounds, used to guarantee we never repeat one. */
  askedQuestions?: string[]
  /** Choice-style questions rendered as selectable options above the composer. */
  choices?: GoalChoice[]
  /** Number of clarification rounds already asked. */
  round: number
  /** Assumptions used when launching despite insufficient information. */
  assumptions?: string[]
  /** Set when the LLM detects the user replaced the previous goal. */
  changed?: boolean
  updatedAt: number
}

/**
 * A "pick one" decision the assistant surfaced at the end of a reply, shown as
 * tappable options above the composer.
 */
export interface PendingChoice {
  /** The question, or a concise restatement of it. */
  prompt: string
  /** Short option labels, in the order the assistant listed them. */
  options: string[]
  /** Assistant message the options were taken from. */
  messageId: string
  createdAt: number
}

/**
 * A clarifying question whose answer is one of a few concrete options. When the
 * judge can enumerate the plausible answers it emits a choice instead of a
 * free-text question, so the UI can render tappable options above the composer.
 */
export interface GoalChoice {
  /** The question text shown to the user. */
  text: string
  /** Concrete, mutually exclusive answers. */
  options: string[]
  /** When true the user may also type a custom answer. */
  allowsCustom?: boolean
  /** When true several options may be selected together. */
  multiple?: boolean
}

/** Request for the one-shot, structured goal-sufficiency judgment. */
export interface GoalAssessRequest {
  provider: ApiProvider
  settings: AppSettings
  /** Full conversation context (user + assistant messages, including clarification Q&A). */
  messages: ChatMessage[]
  /** The message that triggered this assessment (raw user text). */
  latestInput: string
  /** Round index, used to enforce the clarification limit. */
  round: number
  /** Every question already asked in earlier rounds; the judge MUST NOT repeat these. */
  alreadyAsked?: string[]
  language: import('./i18n').AppLanguage
}

/** Structured result of a goal-sufficiency judgment. */
export interface GoalAssessResult {
  sufficient: boolean
  goal: string
  acceptanceCriteria: string
  scope?: string
  constraints?: string
  questions: string[]
  /** Choice-style questions, rendered as selectable options when present. */
  choices?: GoalChoice[]
  assumptions: string[]
  /** True when the user replaced the previous goal instead of answering a question. */
  changed: boolean
  /** Present when judgment failed and the caller should fall back to launching. */
  error?: string
}

export interface GoalTask {
  id: string
  goal: string
  acceptanceCriteria: string
  status: GoalTaskStatus
  webSearchMode?: WebSearchMode
  webSearchScope?: GoalWebSearchScope
  webSearchDomains?: string[]
  contextMode?: GoalContextMode
  resolvedContextMode?: ResolvedGoalContextMode
  contextStartMessageId?: string
  runCount: number
  startedAt: number
  lastRunStartedAt: number
  updatedAt: number
  completedAt?: number
  lastPlan?: AgentExecutionPlan
  lastError?: string
  /** Assumptions recorded when the goal was launched from an under-specified draft. */
  assumptions?: string[]
}

export type SkillStatus = 'draft' | 'active' | 'paused'
export type SkillSourceType = 'local' | 'workspace' | 'imported'

export interface SkillConfig {
  id: string
  projectId?: string
  name: string
  description: string
  instructions: string
  version: string
  status: SkillStatus
  sourceType: SkillSourceType
  sourceLocator?: string
  toolIds: string[]
  revisions?: SkillRevision[]
  evalCases?: SkillEvalCase[]
  lastEvaluation?: SkillEvaluationSummary
  createdAt: number
  updatedAt: number
}

export interface AssistantCapabilitiesChange {
  projectId: string
  assistants: Assistant[]
  skills: SkillConfig[]
}

export interface ConversationSkillInstallationResult {
  conversation: Conversation
  skill: SkillConfig
  capabilities: AssistantCapabilitiesChange
}

export interface SkillRevision {
  version: string
  description: string
  instructions: string
  reason: string
  createdAt: number
}

export interface SkillEvalCase {
  id: string
  input: string
  expectedIncludes: string[]
  sampleOutput: string
  enabled: boolean
  createdAt: number
  lastPassed?: boolean
  lastEvaluatedAt?: number
  lastMissingCriteria?: string[]
}

export interface SkillEvaluationSummary {
  skillVersion: string
  passed: number
  failed: number
  total: number
  evaluatedAt: number
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
export type ProviderModelCapability = ProviderModelType | 'image-tool'

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
  credentialUnavailable?: boolean
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

/** DeepSeek Harness executor configuration, scoped to one workspace. */
export interface WorkspaceHarnessConfig {
  /** Enable the Harness execution engine for this workspace. */
  enabled?: boolean
  /** Fully delegated mode: the whole workspace run is handled by Harness. */
  delegateAll?: boolean
  /** Provider route passed to the Harness runtime (defaults to the active provider's template). Any OpenAI-compatible provider is supported. */
  provider?: string
  /** Model id passed to the Harness runtime (defaults to the provider's default model). */
  model?: string
  /** Named Harness profile (default sdk-minimal). */
  profile?: string
  /** Optional absolute path to an externally prepared runtime directory. */
  runtimePath?: string
}

/**
 * Global execution policy for the agent. This decides how much the agent may do
 * on its own; it never widens the workspace permission, enabled tools, sandbox
 * boundary or any operating-system guard.
 */
export type AgentPermissionMode = 'ask' | 'auto' | 'full'

export const AGENT_PERMISSION_MODES: AgentPermissionMode[] = ['ask', 'auto', 'full']

export interface ConversationWorkspace {
  projectId?: string
  kind?: 'managed' | 'external'
  rootPath: string
  displayName: string
  permission: 'read' | 'read-write'
  approvalMode?: AgentPermissionMode
  executionMode?: 'sandbox' | 'host'
  sandboxNetwork?: boolean
  nativeExecution?: boolean
  computerAccess?: boolean
  browserAccess?: boolean
  computerWindowAccess?: boolean
  browserWindowAccess?: boolean
  loadAgentsMd?: boolean
  envNames?: string[]
  harness?: WorkspaceHarnessConfig
  grantedAt: number
  lastVerifiedAt: number
}

/** Status of the embedded DeepSeek Harness runtime, surfaced to the UI. */
export interface HarnessRuntimeStatus {
  installed: boolean
  nodeVersion?: string
  reason?: string
  bridgeVersion?: string
}

export interface WorkspaceToolActivity {
  id: string
  tool: string
  label: string
  status: 'running' | 'completed' | 'failed'
  detail?: string
  /** Wall-clock start time, stamped by the main process when the activity appears. */
  startedAt?: number
  /** Wall-clock finish time, stamped when the activity leaves the running state. */
  endedAt?: number
  /** Files touched by this activity, used by the activity panel timeline. */
  files?: string[]
}

export type AgentPlanStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface AgentPlanStep {
  id: string
  title: string
  status: AgentPlanStepStatus
  detail?: string
  /** Set on steps the model owns through the todo tool; runtime phases omit it. */
  managedBy?: 'model'
  /** Present-continuous label shown while the step is running. */
  activeForm?: string
}

export interface AgentExecutionPlan {
  goal: string
  status: 'planning' | 'executing' | 'verifying' | 'succeeded' | 'failed'
  steps: AgentPlanStep[]
  verification?: string
  startedAt: number
  completedAt?: number
}

/** How a pending agent interaction collects its answer. */
export type WorkspaceInteractionSelection = 'single' | 'multiple' | 'text' | 'confirm'

export type WorkspaceInteractionStatus = 'pending' | 'answered' | 'cancelled' | 'expired'

export interface WorkspaceInteractionOption {
  id: string
  label: string
  description?: string
  recommended?: boolean
}

/**
 * A structured request from the agent runtime that blocks the run until the
 * user answers. `kind: 'question'` covers plan/parameter choices, `kind: 'auth'`
 * asks the user to complete authentication outside the model context.
 */
export interface WorkspaceInteractionRequest {
  id: string
  conversationId: string
  taskId?: string
  runId?: string
  kind: 'question' | 'auth'
  title: string
  description?: string
  selection: WorkspaceInteractionSelection
  options: WorkspaceInteractionOption[]
  allowCustom: boolean
  allowSkip: boolean
  context?: string
  createdAt: number
  expiresAt?: number
}

export interface WorkspaceInteractionResponse {
  id: string
  selectedIds: string[]
  customText?: string
  cancelled: boolean
  answeredAt: number
}

export interface WorkspaceInteractionRecord {
  request: WorkspaceInteractionRequest
  status: WorkspaceInteractionStatus
  response?: WorkspaceInteractionResponse
  resolvedAt?: number
}

export interface WorkspaceApprovalRisk {
  level: 'low' | 'medium' | 'high'
  /** Whether the underlying change can be rolled back (backup, git, checkpoint). */
  reversible?: boolean
  /** Human-readable blast radius, e.g. "12 files under Docs/". */
  impact?: string
  /** High-risk operations require an explicit second acknowledgement. */
  requiresAcknowledgement?: boolean
}

export interface WorkspaceApprovalPrompt {
  risk?: WorkspaceApprovalRisk
  tool?: string
  capability?: 'computer' | 'browser'
  preview?: string
  backgroundTimeoutMs?: number
  executionMode?: 'sandbox' | 'host'
  sandboxNetwork?: boolean
  nativeExecution?: boolean
  code?: string
  cwd?: string
  envNames?: string[]
  id: string
  conversationId: string
  purpose: string
  workspaceName: string
  canWrite: boolean
  isScript: boolean
}

/** Change notification for the global permission mode, pushed to every window. */
export interface AgentPermissionModeChange {
  conversationId: string
  mode: AgentPermissionMode
  /** False when the conversation state was not persisted (draft or read-only workspace). */
  persisted: boolean
}

export interface WorkspaceAgentRequest {
  conversationId: string
  goalId?: string
  retryAttempts?: MessageRetryAttempt[]
  assistant: Assistant
  assistantSkills?: SkillConfig[]
  assistantTools?: ToolConfig[]
  availableAssistants?: Assistant[]
  delegationContext?: AssistantDelegationContext
  workspace: ConversationWorkspace
  provider: ApiProvider
  messages: ChatMessage[]
  settings: AppSettings
  reasoningEffort?: ReasoningEffort
  webSearchMode?: WebSearchMode
  webSearchEnabled?: boolean
  webSearchScope?: GoalWebSearchScope
  webSearchDomains?: string[]
  projectMemory?: ConversationProjectMemory
  executionLimits?: {
    maxTurns: number
    maxDurationMs: number
  }
}

export interface WorkspaceAgentProgress {
  conversationId: string
  activity: WorkspaceToolActivity
  changedFiles?: string[]
  /** Present when the model rebuilt its todo checklist mid-run. */
  plan?: AgentExecutionPlan
}

/** A goal the agent suggests during a run. The user decides whether to start it. */
export interface WorkspaceGoalProposal {
  id: string
  conversationId: string
  goal: string
  acceptanceCriteria: string
  reason?: string
  proposedAt: number
}

export interface WorkspaceRunSnapshot {
  conversationId: string
  startedAt: number
  activities: WorkspaceToolActivity[]
  changedFiles: string[]
}

export interface WorkspaceAgentResult {
  conversationId: string
  content: string
  activities: WorkspaceToolActivity[]
  changedFiles: string[]
  contextSavings?: ContextSavings
  plan: AgentExecutionPlan
}

export interface AssistantDelegationContext {
  path: string[]
  depth: number
  maxDepth: number
  remainingCalls: number
}

export type AgentRunKind = 'chat' | 'workspace'

export type AgentRunStatus =
  | 'queued'
  | 'planning'
  | 'running_model'
  | 'running_tool'
  | 'waiting_approval'
  | 'verifying'
  | 'retrying'
  | 'stopped'
  | 'succeeded'
  | 'failed'
  | 'interrupted'

export type AgentRunEventType =
  | 'run_started'
  | 'context_prepared'
  | 'model_request_started'
  | 'model_request_completed'
  | 'model_request_failed'
  | 'model_retrying'
  | 'tool_started'
  | 'tool_completed'
  | 'tool_failed'
  | 'approval_waiting'
  | 'approval_resolved'
  | 'verification_started'
  | 'verification_passed'
  | 'verification_failed'
  | 'run_stopped'
  | 'run_succeeded'
  | 'run_failed'
  | 'run_interrupted'

export interface AgentRunEvent {
  id: string
  runId: string
  conversationId: string
  sequence: number
  type: AgentRunEventType
  status: AgentRunStatus
  at: number
  details?: Record<string, string | number | boolean | null>
}

export interface AgentRunRecord {
  id: string
  kind: AgentRunKind
  conversationId: string
  requestKey: string
  providerId: string
  modelId: string
  status: AgentRunStatus
  startedAt: number
  updatedAt: number
  finishedAt?: number
  lastEventType: AgentRunEventType
  eventCount: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  changedFiles?: number
  errorCategory?: string
}

export interface AgentRunSnapshot {
  version: 1
  updatedAt: number
  runs: AgentRunRecord[]
}

export interface WorkspaceAgentRuntimeEvent {
  type: AgentRunEventType
  status: AgentRunStatus
  details?: Record<string, string | number | boolean | null>
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
  webSearchMode: WebSearchMode
  /** Default global permission mode applied to new agent tasks. */
  agentPermissionMode: AgentPermissionMode
  /** When true the permission choice follows the user across sessions. */
  rememberAgentPermission: boolean
  /** Set once the user accepted the full-access warning. */
  fullAccessAcknowledged: boolean
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
  assistantSkills?: SkillConfig[]
  projectMemory?: ConversationProjectMemory
  provider: ApiProvider
  messages: ChatMessage[]
  settings: AppSettings
  reasoningEffort?: ReasoningEffort
  webSearchMode?: WebSearchMode
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
  contextSavings?: ContextSavings
  purpose?: 'chat' | 'translation'
  targetMessageId?: string
  done?: boolean
  error?: string
  warning?: string
  cancelled?: boolean
  finishReason?: string
  isTruncated?: boolean
}

export interface ChatActivityEvent {
  conversationId: string
  active: boolean
  error?: string
  kind?: AgentRunKind
  startedAt?: number
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
  storeManaged?: boolean
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
  workspaceRuns: WorkspaceRunSnapshot[]
  notes: KnowledgeNote[]
  memories: AssistantMemory[]
  tools: ToolConfig[]
  skills: SkillConfig[]
}

export interface AssistantTemplateBundle {
  schemaVersion: 1
  exportedAt: number
  publisher?: string
  assistant: Assistant
  skills: SkillConfig[]
  tools: ToolConfig[]
}

export interface AssistantTemplateImportResult {
  assistant: Assistant
  skills: SkillConfig[]
  tools: ToolConfig[]
  warnings: string[]
}

export interface WorkspaceDiagnosticOptions { executionMode: 'sandbox' | 'host'; sandboxNetwork: boolean }
export interface WorkspaceDiagnosticResult {
  checkedAt: number
  checks: Array<{ id: 'folder' | 'python' | 'shell' | 'writeback' | 'isolation' | 'dns' | 'network'; status: 'passed' | 'failed' | 'skipped'; detail: string }>
}
