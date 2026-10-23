/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAssistantSettings } from './applicationConfigPolicy.ts'

test('only supported non-credential configuration is accepted', () => {
  assert.deepEqual(validateAssistantSettings({ theme: 'dark', language: 'en-US', webSearchMode: 'on', messageSendShortcut: 'ctrl-enter' }), { theme: 'dark', language: 'en-US', webSearchMode: 'on', messageSendShortcut: 'ctrl-enter' })
  for (const patch of [{ apiKey: 'secret' }, { nativeExecution: true }, { telemetryEnabled: true }, { theme: 'gold' }, { maxTokens: -1 }, { temperature: NaN }, { language: 'invalid' }, { floatingMascotVisible: 'false' }, { timeZone: 'invalid' }, {}]) {
    assert.throws(() => validateAssistantSettings(patch))
  }
})
