/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHarnessPrompt } from './harnessWorkspace.ts'

function msg(role: string, content: string) {
  return { id: role + Math.random(), role, content, createdAt: Date.now() } as any
}

test('buildHarnessPrompt includes goal and recent conversation', () => {
  const prompt = buildHarnessPrompt([
    msg('user', 'first old message'),
    msg('assistant', 'old reply'),
    msg('user', 'fix the login bug')
  ], '修复登录缺陷')
  assert.match(prompt, /修复登录缺陷/)
  assert.match(prompt, /fix the login bug/)
  assert.match(prompt, /<conversation>/)
  assert.match(prompt, /\[用户\]/)
})

test('buildHarnessPrompt falls back to continue instruction without goal', () => {
  const prompt = buildHarnessPrompt([msg('user', 'do the thing')])
  assert.match(prompt, /继续在工作区中完成/)
  assert.match(prompt, /do the thing/)
})

test('buildHarnessPrompt ignores empty/other roles and caps history', () => {
  const messages = Array.from({ length: 30 }, (_, i) => msg('user', `message-${i}`))
  messages.push({ id: 'sys', role: 'system', content: 'system-only', createdAt: Date.now() } as any)
  const prompt = buildHarnessPrompt(messages)
  assert.match(prompt, /message-29/)
  assert.doesNotMatch(prompt, /message-0\b/)
  assert.doesNotMatch(prompt, /system-only/)
})
