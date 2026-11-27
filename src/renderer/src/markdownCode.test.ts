/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { codeFenceLabel, plainCodeText } from './markdownCode.ts'

test('the copy payload is the fence source, not the rendered fragments', () => {
  assert.equal(plainCodeText('git status'), 'git status')
  assert.equal(plainCodeText(42), '42')
  assert.equal(plainCodeText(null), '')
  assert.equal(plainCodeText(undefined), '')
  assert.equal(plainCodeText(true), '')
  // react-markdown hands over an element (or an array of strings/elements).
  assert.equal(plainCodeText({ props: { children: 'ls -la' } }), 'ls -la')
  assert.equal(plainCodeText([{ props: { children: 'git add -A' } }, '\n']), 'git add -A\n')
  assert.equal(plainCodeText([{ props: { children: [{ props: { children: 'a' } }, 'b'] } }]), 'ab')
})

test('copying preserves newlines and characters that HTML would escape', () => {
  const source = 'git commit -m "fix: a > b & c"\nnpm run test -- --grep "<retry>"'
  const rendered = [{ props: { children: source } }]
  assert.equal(plainCodeText(rendered), source)
  // A trailing newline is part of the rendered node for some fences; it must not
  // become an extra blank line in the terminal.
  assert.equal(plainCodeText([{ props: { children: source } }, '\n']).trimEnd(), source)
})

test('shell dialects share one header label and other languages keep their name', () => {
  assert.equal(codeFenceLabel('bash'), 'shell')
  assert.equal(codeFenceLabel('PowerShell'), 'shell')
  assert.equal(codeFenceLabel('cmd'), 'shell')
  assert.equal(codeFenceLabel('ts'), 'ts')
  assert.equal(codeFenceLabel('JSON'), 'json')
  assert.equal(codeFenceLabel(''), '')
  assert.equal(codeFenceLabel(undefined), '')
})
