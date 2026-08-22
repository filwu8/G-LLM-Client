/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { redactMainLogText } from './logRedaction.ts'

test('redacts common credentials from diagnostic logs', () => {
  const source = 'Authorization: Bearer abc.def-123 api_key=sk-abcdefghijklmnop secret:private-value'
  const redacted = redactMainLogText(source)

  assert.equal(redacted.includes('abc.def-123'), false)
  assert.equal(redacted.includes('sk-abcdefghijklmnop'), false)
  assert.equal(redacted.includes('private-value'), false)
  assert.match(redacted, /REDACTED/)
})

test('keeps request metadata and bounds log entry size', () => {
  const redacted = redactMainLogText(`model=gpt-5.6-sol\n${'x'.repeat(8_000)}`)

  assert.match(redacted, /model=gpt-5\.6-sol/)
  assert.equal(redacted.includes('\n'), false)
  assert.equal(redacted.length, 6_000)
})
