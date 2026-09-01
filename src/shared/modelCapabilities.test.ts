/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApiProvider } from './types.ts'
import { resolveImageGenerationModel } from './modelCapabilities.ts'

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
