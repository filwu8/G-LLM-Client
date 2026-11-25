/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { parseStreamDataPayload, readStreamError, type StreamUsageState } from './chatStreamParser.ts'
import {
  buildChatRequest,
  buildModelListRequest,
  readCompletionText,
  readModelRecords,
  resolveProviderProtocol
} from './providerProtocol.ts'
import type { ApiProvider } from '../shared/types'

function anthropicProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'provider_anthropic',
    templateId: 'anthropic',
    protocol: 'anthropic',
    name: 'Anthropic',
    apiBaseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    defaultModel: 'claude-sonnet-4-5',
    models: [],
    requiresApiKey: true,
    ...overrides
  }
}

function geminiProvider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'provider_gemini',
    templateId: 'gemini-native',
    protocol: 'gemini',
    name: 'Gemini',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'gm-key',
    defaultModel: 'gemini-2.5-flash',
    models: [],
    requiresApiKey: true,
    ...overrides
  }
}

test('the protocol follows an explicit value, then the template, then the endpoint', () => {
  // An explicit value must win: people point the Anthropic template at a proxy
  // whose host looks nothing like api.anthropic.com.
  assert.equal(
    resolveProviderProtocol({ apiBaseUrl: 'https://gateway.internal/v1', protocol: 'anthropic' }),
    'anthropic'
  )
  // A pinned template outranks the endpoint for the same reason.
  assert.equal(
    resolveProviderProtocol({ apiBaseUrl: 'https://gateway.internal/v1', templateId: 'gemini-native' }),
    'gemini'
  )
  // Configs written before the field existed carry no template hint worth
  // using, so the endpoint decides - and /openai must stay on the shim.
  assert.equal(resolveProviderProtocol({ apiBaseUrl: 'https://api.anthropic.com/v1' }), 'anthropic')
  assert.equal(resolveProviderProtocol({ apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta' }), 'gemini')
  assert.equal(
    resolveProviderProtocol({ apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }),
    'openai'
  )
  assert.equal(resolveProviderProtocol({ apiBaseUrl: 'https://api.deepseek.com/v1' }), 'openai')
  assert.equal(resolveProviderProtocol({ apiBaseUrl: 'not a url' }), 'openai')
})

test('an Anthropic request hoists the system prompt and merges adjacent turns', () => {
  const spec = buildChatRequest('anthropic', anthropicProvider(), {
    model: 'claude-sonnet-4-5',
    temperature: 1.6,
    messages: [
      { role: 'system', content: 'Be terse.' },
      { role: 'system', content: 'Answer in Chinese.' },
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'third' }
    ]
  })

  assert.equal(spec.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(spec.headers['x-api-key'], 'sk-ant-test')
  assert.equal(spec.headers['anthropic-version'], '2023-06-01')
  assert.equal(spec.headers.Authorization, undefined, 'Anthropic reads x-api-key, not a bearer token')

  // The API rejects system turns inside `messages` and requires alternation.
  assert.equal(spec.body.system, 'Be terse.\n\nAnswer in Chinese.')
  const messages = spec.body.messages as Array<{ role: string; content: Array<{ type: string; text?: string }> }>
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user'])
  assert.deepEqual(messages[0].content.map((block) => block.text), ['first', 'second'])
  // max_tokens is mandatory, and temperature above 1 is out of range.
  assert.equal(spec.body.max_tokens, 4096)
  assert.equal(spec.body.temperature, 1)
  assert.equal(spec.body.stream, false)
})

test('an Anthropic request converts image attachments instead of forwarding OpenAI parts', () => {
  const spec = buildChatRequest('anthropic', anthropicProvider(), {
    model: 'claude-sonnet-4-5',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
          { type: 'image_url', image_url: { url: 'https://example.com/a.png' } }
        ]
      }
    ]
  })

  const messages = spec.body.messages as Array<{ content: Array<Record<string, unknown>> }>
  assert.deepEqual(messages[0].content[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' }
  })
  assert.deepEqual(messages[0].content[2], {
    type: 'image',
    source: { type: 'url', url: 'https://example.com/a.png' }
  })
})

test('a system-only request still produces a usable Anthropic body', () => {
  const spec = buildChatRequest('anthropic', anthropicProvider(), {
    model: 'claude-sonnet-4-5',
    messages: [{ role: 'system', content: 'Return JSON only.' }]
  })
  assert.equal(spec.body.system, 'Return JSON only.')
  const messages = spec.body.messages as Array<{ role: string }>
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'user')
})

test('a Gemini request maps roles, inlines images, and keeps the key out of the URL', () => {
  const spec = buildChatRequest('gemini', geminiProvider(), {
    model: 'gemini-2.5-flash',
    temperature: 0.3,
    maxTokens: 900,
    jsonMode: true,
    stream: true,
    messages: [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }
        ]
      }
    ]
  })

  assert.equal(
    spec.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
  )
  assert.equal(spec.headers['x-goog-api-key'], 'gm-key')
  assert.ok(!spec.url.includes('key='), 'the key must not travel in the query string')
  assert.deepEqual(spec.body.systemInstruction, { parts: [{ text: 'Be brief.' }] })

  const contents = spec.body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
  assert.deepEqual(contents.map((item) => item.role), ['user', 'model', 'user'])
  assert.deepEqual(contents[2].parts[1], { inlineData: { mimeType: 'image/png', data: 'QUJD' } })
  assert.deepEqual(spec.body.generationConfig, {
    temperature: 0.3,
    maxOutputTokens: 900,
    responseMimeType: 'application/json'
  })
})

test('an OpenAI request keeps its existing shape', () => {
  const spec = buildChatRequest('openai', {
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    chatCompletionsPath: '/chat/completions'
  }, {
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2,
    maxTokens: 100,
    jsonMode: true
  })

  assert.equal(spec.url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(spec.headers.Authorization, 'Bearer sk-test')
  assert.deepEqual(spec.body.response_format, { type: 'json_object' })
  assert.equal(spec.body.max_tokens, 100)
})

test('completion text is read from each protocol payload', () => {
  assert.equal(
    readCompletionText('openai', { choices: [{ message: { content: 'a' } }] }),
    'a'
  )
  assert.equal(
    readCompletionText('anthropic', { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'b' }] }),
    'b'
  )
  assert.equal(
    readCompletionText('gemini', {
      candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'c' }] } }]
    }),
    'c',
    'thinking parts must not leak into the answer'
  )
})

test('model lists are normalised per protocol', () => {
  assert.deepEqual(
    readModelRecords('gemini', {
      models: [
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
        { name: 'models/gemini-2.5-flash' },
        { name: 'models/gemini-2.5-pro' }
      ]
    }),
    [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash' }
    ]
  )
  assert.deepEqual(
    readModelRecords('anthropic', { data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }] }),
    [{ id: 'claude-sonnet-4-5' }]
  )
  assert.deepEqual(
    readModelRecords('openai', { data: [{ id: 'gpt-4.1', owned_by: 'openai' }] }),
    [{ id: 'gpt-4.1', ownedBy: 'openai' }]
  )
})

test('the model list request uses the header each API authenticates with', () => {
  assert.deepEqual(buildModelListRequest('anthropic', anthropicProvider()), {
    url: 'https://api.anthropic.com/v1/models?limit=100',
    headers: { 'anthropic-version': '2023-06-01', 'x-api-key': 'sk-ant-test' }
  })
  assert.deepEqual(buildModelListRequest('gemini', geminiProvider()), {
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
    headers: { 'x-goog-api-key': 'gm-key' }
  })
})

test('Anthropic stream events become the same events the chat path already handles', () => {
  const state: StreamUsageState = { anthropicInputTokens: 0 }

  const start = parseStreamDataPayload(
    JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 42 } } }),
    state
  )
  assert.deepEqual(start?.usage, { inputTokens: 42, outputTokens: 0, totalTokens: 42 })
  assert.equal(start?.content, '')

  const text = parseStreamDataPayload(
    JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '你好' } }),
    state
  )
  assert.equal(text?.content, '你好')

  const thinking = parseStreamDataPayload(
    JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '想' } }),
    state
  )
  assert.equal(thinking?.reasoningContent, '想')

  const delta = parseStreamDataPayload(
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 7 } }),
    state
  )
  // Prompt tokens arrive in an earlier frame; the consumer keeps only the last
  // usage it sees, so the completion frame has to carry the running total.
  assert.deepEqual(delta?.usage, { inputTokens: 42, outputTokens: 7, totalTokens: 49 })
  assert.equal(delta?.finishReason, 'max_tokens')
  assert.equal(delta?.isTruncated, true)
})

test('Gemini stream chunks carry text, parts, and usage', () => {
  const chunk = parseStreamDataPayload(JSON.stringify({
    candidates: [{
      content: { parts: [{ text: '生成' }, { text: '中', thought: true }] },
      finishReason: 'STOP'
    }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3, totalTokenCount: 14 }
  }))

  assert.equal(chunk?.content, '生成')
  assert.equal(chunk?.finishReason, 'stop')
  assert.deepEqual(chunk?.usage, { inputTokens: 11, outputTokens: 3, totalTokens: 14 })
})

test('a mid-stream error frame is surfaced instead of ending as an empty answer', () => {
  const failure = readStreamError(JSON.stringify({
    type: 'error',
    error: { type: 'overloaded_error', message: 'Overloaded' }
  }))
  assert.ok(failure instanceof Error)
  assert.match(failure.message, /overloaded_error: Overloaded/)
  assert.equal(readStreamError(JSON.stringify({ type: 'content_block_delta' })), null)
  assert.equal(readStreamError('not json'), null)
})
