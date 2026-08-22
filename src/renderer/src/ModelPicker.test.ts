/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { getCompactModelTitle } from './modelDisplay.ts'

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
