/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GOLD_THEME_REVIEW_REQUEST_COUNT,
  evaluateGoldThemeEligibility
} from './themeEntitlement.ts'

test('keeps the gold theme available during the new-user observation period', () => {
  assert.equal(evaluateGoldThemeEligibility(0, 0).eligible, true)
  assert.equal(evaluateGoldThemeEligibility(GOLD_THEME_REVIEW_REQUEST_COUNT - 1, 0).eligible, true)
  assert.equal(evaluateGoldThemeEligibility(0, 0).reviewComplete, false)
})

test('enforces the official usage ratio after the observation period', () => {
  assert.equal(evaluateGoldThemeEligibility(10, 5).eligible, false)
  assert.equal(evaluateGoldThemeEligibility(10, 6).eligible, true)
  assert.equal(evaluateGoldThemeEligibility(20, 10).eligible, false)
  assert.equal(evaluateGoldThemeEligibility(20, 11).eligible, true)
  assert.equal(evaluateGoldThemeEligibility(10, 6).reviewComplete, true)
})
