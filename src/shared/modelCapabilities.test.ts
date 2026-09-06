/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApiProvider } from './types.ts'
import {
  inferModelCapabilities,
  inferModelCapabilitiesFromMetadata,
  inferModelTypeFromMetadata,
  canGenerateImages,
  normalizeModelCapabilities,
  resolveImageGenerationToolModel,
  resolveImageGenerationModel
} from './modelCapabilities.ts'

function provider(models: ApiProvider['models'], defaultModel = 'gpt-5.4'): ApiProvider {
  return {
    id: 'test',
    templateId: 'local-compatible',
    name: 'Test',
    apiBaseUrl: 'http://localhost:8000/v1',
    apiKey: '',
    requiresApiKey: false,
    defaultModel,
    models
  }
}

test('uses a separate image model when the default model only writes prompts', () => {
  const result = resolveImageGenerationModel(provider([
    { id: 'gpt-5.4', capabilities: ['chat', 'vision'] },
    { id: 'flux-1', capabilities: ['image'] }
  ]))

  assert.equal(result?.id, 'flux-1')
})

test('prefers an image-capable default model', () => {
  const result = resolveImageGenerationModel(provider([
    { id: 'flux-fast', capabilities: ['image'] },
    { id: 'gpt-image-1', capabilities: ['image'] }
  ], 'gpt-image-1'))

  assert.equal(result?.id, 'gpt-image-1')
})

test('does not mistake vision input for image generation', () => {
  const result = resolveImageGenerationModel(provider([
    { id: 'gpt-5.4', capabilities: ['chat', 'vision'] }
  ]))

  assert.equal(result, undefined)
})

test('recognizes officially documented Responses image tools for the current OpenAI model family', () => {
  for (const model of [
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.5',
    'gpt-5.6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-6-astra'
  ]) {
    assert.deepEqual(inferModelCapabilities(model), ['chat', 'vision', 'image-tool'])
  }

  assert.deepEqual(inferModelCapabilities('gpt-5.6-unknown'), ['chat', 'vision'])
})

test('keeps the vision fallback for future GPT major versions', () => {
  assert.deepEqual(inferModelCapabilities('gpt-7-example'), ['chat', 'vision'])
})

test('recognizes OpenAI input_modalities metadata as image understanding', () => {
  const metadata = {
    id: 'custom-frontier-model',
    input_modalities: ['text', 'image']
  }

  assert.equal(inferModelTypeFromMetadata(metadata.id, metadata), 'vision')
  assert.deepEqual(inferModelCapabilitiesFromMetadata(metadata.id, metadata), ['chat', 'vision'])
})

test('recognizes nested supportedInputModalities metadata as image understanding', () => {
  const metadata = {
    id: 'custom-nested-model',
    architecture: {
      supportedInputModalities: ['text', 'image']
    }
  }

  assert.deepEqual(inferModelCapabilitiesFromMetadata(metadata.id, metadata), ['chat', 'vision'])
})

test('keeps the documented image tool when an OpenAI-compatible model list only returns basic metadata', () => {
  const metadata = {
    id: 'gpt-5.6-sol',
    object: 'model',
    owned_by: 'openai'
  }

  assert.deepEqual(inferModelCapabilitiesFromMetadata(metadata.id, metadata), ['chat', 'vision', 'image-tool'])
})

test('distinguishes a Responses image tool from a direct image model', () => {
  const metadata = {
    id: 'custom-frontier-model',
    input_modalities: ['text', 'image'],
    supported_tools: ['image_generation']
  }

  assert.equal(inferModelTypeFromMetadata(metadata.id, metadata), 'vision')
  assert.deepEqual(inferModelCapabilitiesFromMetadata(metadata.id, metadata), ['chat', 'vision', 'image-tool'])
})

test('selects a documented Responses image-tool model without treating it as an image endpoint model', () => {
  const current = provider([
    { id: 'gpt-5.5', capabilities: ['chat', 'vision'] },
    { id: 'gpt-5.6-luna', capabilities: inferModelCapabilities('gpt-5.6-luna') }
  ], 'gpt-5.6-luna')

  assert.equal(resolveImageGenerationModel(current), undefined)
  assert.equal(resolveImageGenerationToolModel(current)?.id, 'gpt-5.6-luna')
  assert.equal(canGenerateImages(current), true)
  assert.deepEqual(normalizeModelCapabilities({ id: 'gpt-5.6-luna' }), ['chat', 'vision', 'image-tool'])
  assert.deepEqual(
    normalizeModelCapabilities({ id: 'gpt-5.6-terra', capabilities: ['chat', 'vision'] }),
    ['chat', 'vision', 'image-tool']
  )
})
