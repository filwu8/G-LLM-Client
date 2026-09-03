/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { applyWorkspaceSearchScope, buildWorkspaceSearchQuery, normalizeGoalWebSearchDomains } from './goalWebSearch.ts'

test('normalizes goal search domains and removes paths and duplicates', () => {
  assert.deepEqual(normalizeGoalWebSearchDomains('https://www.microsoft.com/docs, github.com microsoft.com'), [
    'microsoft.com',
    'github.com'
  ])
})

test('restricts specified-site results to the configured domains and subdomains', () => {
  const results = [
    { title: 'Docs', url: 'https://learn.microsoft.com/test' },
    { title: 'Blog', url: 'https://example.com/test' }
  ]
  assert.match(buildWorkspaceSearchQuery('Windows API', 'specified', ['microsoft.com']), /site:microsoft\.com/)
  assert.deepEqual(applyWorkspaceSearchScope(results, 'specified', ['microsoft.com']), [{
    ...results[0],
    sourceTrust: 'user-specified'
  }])
})

test('moves likely official sources ahead without removing other useful sources', () => {
  const results = [
    { title: 'Community summary', url: 'https://example.com/story' },
    { title: '产品官方网站', url: 'https://vendor.com/product' }
  ]
  assert.deepEqual(applyWorkspaceSearchScope(results, 'official', [], new Set(['vendor.com'])), [
    { ...results[1], sourceTrust: 'likely-official' },
    { ...results[0], sourceTrust: 'third-party' }
  ])
})
