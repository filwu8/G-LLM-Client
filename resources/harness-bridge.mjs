/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 *
 * DeepSeek Harness bridge.
 *
 * Runs under a dedicated Node >= 24.9 runtime (NOT the Electron main process).
 * Speaks a line-delimited JSON protocol on stdin/stdout so the Electron main
 * process can drive the official @deepseek-ai/dsh-sdk-client without loading
 * the large dsh dependency tree into the app bundle.
 *
 * Host -> bridge (one JSON object per line):
 *   { id, method: 'init', params: { provider, model, apiKey, baseUrl?, dshHome, cwd, approvalRequests, maxTokens? } }
 *   { id, method: 'run', params: { prompt, sessionId? } }
 *   { id, method: 'approval', params: { callId, outcome } }
 *   { id, method: 'userQuestion', params: { requestId, answers?, cancelled? } }
 *   { id, method: 'status' }
 *   { id, method: 'close' }
 *
 * Bridge -> host (one JSON object per line):
 *   { id, ok: true, result } | { id, ok: false, error: { name, message } }
 *   { event: 'notification', notification }
 *   { event: 'approval_request', callId, params }
 *   { event: 'user_question', requestId, params }
 *   { event: 'log', level, message }
 */

import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

// The dsh runtime lives in a directory adjacent to this script (packaged) or
// is provided via DSH_BRIDGE_RUNTIME. Resolve the SDK client from there so the
// app's own node_modules never needs the full dsh tree.
const runtimeDir = process.env.DSH_BRIDGE_RUNTIME || ''
let sdkClientModule
let protocolModule

function sdkUrl(pkg, sub = 'lib/index.js') {
  const base = runtimeDir ? resolvePath(runtimeDir, 'node_modules') : 'node_modules'
  return pathToFileURL(resolvePath(base, '@deepseek-ai', pkg, sub)).href
}

function emit(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + '\n')
  } catch {
    // A non-serializable value must not kill the bridge.
    process.stdout.write(JSON.stringify({ event: 'log', level: 'error', message: 'Failed to serialize an outbound message' }) + '\n')
  }
}

function log(message, level = 'info') {
  emit({ event: 'log', level, message: String(message).slice(0, 2000) })
}

// Pending host answers for runtime approval requests and user questions.
const pendingApprovals = new Map()
const pendingQuestions = new Map()

let harness = null
let client = null
let initialized = false
let closing = false

async function loadSdk() {
  if (sdkClientModule) return
  try {
    sdkClientModule = await import(sdkUrl('dsh-sdk-client'))
  } catch (error) {
    // Source-checkout fallback: load the TypeScript SDK via tsx if present.
    const loader = process.env.DSH_BRIDGE_TSX_LOADER
    if (loader) {
      try {
        const { register } = await import(loader)
        register()
        sdkClientModule = await import(sdkUrl('dsh-sdk-client', 'src/index.ts'))
      } catch (inner) {
        throw new Error(`dsh-sdk-client unavailable: ${error.message}; tsx fallback failed: ${inner.message}`)
      }
    } else {
      throw new Error(`dsh-sdk-client unavailable from ${runtimeDir || 'local node_modules'}: ${error.message}`)
    }
  }
}

function redactForHost(obj) {
  // The protocol may carry credential-bearing fields; strip the obvious ones.
  if (!obj || typeof obj !== 'object') return obj
  const clone = { ...obj }
  for (const key of ['apiKey', 'apiKeyEnv', 'token', 'secret', 'authorization']) {
    if (key in clone) clone[key] = '[redacted]'
  }
  return clone
}

// Known provider -> the env var its native/pi-ai adapter reads for the key.
// The sdk-minimal profile only ships the DeepSeek adapter; every other route
// is served by the generic pi-ai adapter through a generated patch below.
const PROVIDER_KEY_ENV = {
  'deepseek-official': 'DEEPSEEK_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  moonshotai: 'MOONSHOT_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  zai: 'ZAI_API_KEY',
  zhipu: 'ZAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  'google-gemini': 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY'
}

// Only DeepSeek's native adapter is mounted by sdk-minimal. Everything else
// needs the pi-ai adapter, selected by a route name we declare in a patch.
function isNativeDeepSeekRoute(provider, baseUrl) {
  if (provider === 'deepseek-official' || provider === 'deepseek') {
    const url = String(baseUrl || '').toLowerCase()
    if (!url || url.includes('api.deepseek.com')) return true
  }
  return false
}

function safeRouteName(provider) {
  const slug = String(provider).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return slug || 'gllm-gateway'
}

function yamlScalar(value) {
  return String(value).replace(/["\\]/g, (ch) => `\\${ch}`)
}

// Build a patch that mounts the generic OpenAI-compatible adapter and declares
// one route for the selected provider. No key material is written to disk: the
// adapter resolves apiKeyEnv from the child process environment at request time.
async function writeProviderPatch(dshHome, route, { apiKeyEnv, baseUrl, model }) {
  const home = resolvePath(dshHome || '.')
  await mkdir(home, { recursive: true })
  const file = resolvePath(home, `gllm-provider-${route}.patch.yml`)
  const apiLine = baseUrl ? `            api: openai-completions\n            baseURL: ${yamlScalar(baseUrl)}\n` : ''
  const models = model ? `\n            models:\n              - id: ${yamlScalar(model)}` : ''
  const patch =
    '- insert:\n' +
    '    - id: llm-pi-ai\n' +
    "      name: '@deepseek-ai/dsh-llm-pi-ai'\n" +
    '      config:\n' +
    '        providers:\n' +
    `          ${route}:\n` +
    `            apiKeyEnv: ${apiKeyEnv}\n` +
    apiLine +
    '            displayName: G-LLM provider' +
    models + '\n'
  await writeFile(file, patch, 'utf8')
  return file
}

async function init(params) {
  if (initialized) return { alreadyInitialized: true }
  await loadSdk()
  const { DeepSeekHarness } = sdkClientModule
  const provider = String(params.provider || 'gllm')
  const model = String(params.model || '')
  const apiKey = String(params.apiKey || '')
  const baseUrl = params.baseUrl ? String(params.baseUrl) : ''
  const dshHome = String(params.dshHome || '')
  const profile = String(params.profile || 'sdk-minimal')

  // Credentials are owned by the host and passed only through this child env.
  const childEnv = { ...process.env }
  // Never let a host-side key leak to the runtime under a different name.
  childEnv.DSH_BRIDGE_RUNTIME = runtimeDir

  let route = provider
  let patches = []
  if (isNativeDeepSeekRoute(provider, baseUrl)) {
    if (apiKey) childEnv.DEEPSEEK_API_KEY = apiKey
    if (baseUrl) childEnv.DEEPSEEK_BASE_URL = baseUrl
  } else {
    if (!model) throw new Error('Harness 需要指定模型；请为该 provider 配置默认模型')
    // Generic OpenAI-compatible gateway: declare a pi-ai route and inject the
    // key under that route's dedicated env var. Works for any model the gateway
    // serves, including hosted aggregators and self-hosted endpoints.
    route = safeRouteName(provider)
    const keyEnv = PROVIDER_KEY_ENV[provider.toLowerCase()] || 'GLLM_PROVIDER_API_KEY'
    if (apiKey) childEnv[keyEnv] = apiKey
    if (baseUrl) childEnv[`${keyEnv}_BASE_URL`] = baseUrl
    const patchFile = await writeProviderPatch(dshHome, route, { apiKeyEnv: keyEnv, baseUrl, model })
    patches = [patchFile]
    log(`Configured pi-ai route '${route}' via ${keyEnv}`)
  }

  harness = new DeepSeekHarness({
    profile,
    dshHome,
    processCwd: String(params.cwd),
    cwd: String(params.cwd),
    provider: route,
    model,
    ...(patches.length ? { patches } : {}),
    ...(Number.isInteger(params.maxTokens) ? { maxTokens: params.maxTokens } : {}),
    approvalRequests: params.approvalRequests !== false,
    initializeTimeoutMs: 60000,
    requestTimeoutMs: 0 === params.requestTimeoutMs ? undefined : (params.requestTimeoutMs || undefined),
    shutdownTimeoutMs: 3000,
    env: childEnv,
    onUserQuestion: async (request, context) => {
      const requestId = String(request.requestId)
      return await new Promise((resolvePromise, reject) => {
        pendingQuestions.set(requestId, { resolve: resolvePromise, reject })
        emit({ event: 'user_question', requestId, params: redactForHost(request) })
        context.signal?.addEventListener('abort', () => {
          if (pendingQuestions.delete(requestId)) reject(new Error('User question cancelled'))
        }, { once: true })
      })
    }
  })

  client = harness.client
  client.start()

  if (params.approvalRequests !== false) {
    client.onRequest(async (method, rpcParams) => {
      if (method !== 'approval/request') throw new Error(`Unsupported request: ${method}`)
      const callId = String(rpcParams.callId || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
      return await new Promise((resolvePromise, reject) => {
        pendingApprovals.set(callId, { resolve: resolvePromise, reject })
        emit({ event: 'approval_request', callId, params: redactForHost(rpcParams) })
      })
    })
  }

  await harness.start()
  initialized = true
  log('Harness initialized', 'info')
  return { serverInfo: { name: 'deepseek-harness-bridge', version: '1.0' } }
}

async function run(params) {
  if (!initialized || !harness) throw new Error('Harness is not initialized')
  const prompt = String(params.prompt ?? '')
  const options = {}
  if (params.sessionId) options.sessionId = String(params.sessionId)
  options.onNotification = (notification) => emit({ event: 'notification', notification: redactForHost(notification) })
  const result = await harness.run(prompt, options)
  return {
    sessionId: result.sessionId,
    finalResponse: result.finalResponse,
    finishReason: result.finishReason,
    eventCount: Array.isArray(result.events) ? result.events.length : 0,
    notificationCount: Array.isArray(result.notifications) ? result.notifications.length : 0
  }
}

async function answerApproval(params) {
  const callId = String(params.callId || '')
  const pending = pendingApprovals.get(callId)
  if (!pending) return { answered: false }
  pendingApprovals.delete(callId)
  const outcome = ['allowed-once', 'rejected', 'cancelled'].includes(params.outcome) ? params.outcome : 'rejected'
  pending.resolve({ outcome })
  return { answered: true }
}

async function answerQuestion(params) {
  const requestId = String(params.requestId || '')
  const pending = pendingQuestions.get(requestId)
  if (!pending) return { answered: false }
  pendingQuestions.delete(requestId)
  if (params.cancelled) {
    pending.resolve({ cancelled: true })
  } else {
    pending.resolve({ answers: Array.isArray(params.answers) ? params.answers : [] })
  }
  return { answered: true }
}

async function closeBridge() {
  if (closing) return { closed: true }
  closing = true
  for (const pending of pendingApprovals.values()) pending.resolve({ outcome: 'cancelled' })
  pendingApprovals.clear()
  for (const pending of pendingQuestions.values()) pending.resolve({ cancelled: true })
  pendingQuestions.clear()
  try {
    if (client) await client.close()
  } catch (error) {
    log(`Close error: ${error.message}`, 'warn')
  } finally {
    initialized = false
  }
  return { closed: true }
}

async function dispatch(message) {
  const { id, method, params = {} } = message
  try {
    let result
    switch (method) {
      case 'init': result = await init(params); break
      case 'run': result = await run(params); break
      case 'approval': result = await answerApproval(params); break
      case 'userQuestion': result = await answerQuestion(params); break
      case 'status': result = { initialized, closing, runtimeDir: runtimeDir || null }; break
      case 'close': result = await closeBridge(); break
      default: throw new Error(`Unknown method: ${method}`)
    }
    emit({ id, ok: true, result })
    if (method === 'close') setTimeout(() => process.exit(0), 50)
  } catch (error) {
    emit({ id, ok: false, error: { name: error?.constructor?.name || 'Error', message: String(error?.message || error).slice(0, 4000) } })
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    emit({ event: 'log', level: 'warn', message: 'Ignored malformed JSON line' })
    return
  }
  // Do not await: run() is long-lived and must not block approval/userQuestion replies.
  void dispatch(message)
})

process.on('uncaughtException', (error) => log(`Uncaught: ${error.stack || error.message}`, 'error'))
process.on('unhandledRejection', (error) => log(`Unhandled rejection: ${String(error)}`, 'error'))
