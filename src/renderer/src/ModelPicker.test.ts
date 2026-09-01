/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { getCompactModelTitle, getModelAccessTier } from './modelDisplay.ts'
import type { ApiProvider } from '@shared/types'

const provider = (templateId: ApiProvider['templateId'], apiBaseUrl: string): ApiProvider => ({
  id: templateId,
  templateId,
  name: templateId,
  apiBaseUrl,
  apiKey: '',
  defaultModel: '',
  models: [],
  requiresApiKey: true
})

test('compact model title removes provider, free tier, and technical suffixes', () => {
  assert.equal(
    getCompactModelTitle({
      id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      name: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
    }),
    'Nemotron 3 Nano'
  )
})

test('compact model title keeps a concise configured display name', () => {
  assert.equal(
    getCompactModelTitle({ id: 'vendor/model-with-a-long-id', name: 'Friendly Model' }),
    'Friendly Model'
  )
})

test('model access tier only applies the free suffix rule to the G-Prophet API', () => {
  const gprophet = provider('gllm', 'https://llm.gprophet.com/v1/')
  const openRouter = provider('openrouter', 'https://openrouter.ai/api/v1')
  const local = provider('local-compatible', 'http://127.0.0.1:8000/v1')
  assert.equal(getModelAccessTier(gprophet, { id: 'vendor/model:free' }), 'free')
  assert.equal(getModelAccessTier(gprophet, { id: 'vendor/model' }), 'paid')
  assert.equal(getModelAccessTier(openRouter, { id: 'vendor/model:free' }), null)
  assert.equal(getModelAccessTier(local, { id: 'vendor/model' }), null)
})
