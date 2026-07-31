/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  inspectGllmDeepLinkArguments,
  parseGllmDeepLink,
  redactGllmDeepLinkArguments
} from './deepLink.ts'

const handoffCode = 'a'.repeat(64)

test('accepts only the open action and a whitelisted G-LLM source', () => {
  assert.deepEqual(parseGllmDeepLink('gllm://open'), { action: 'open' })
  assert.deepEqual(parseGllmDeepLink('gllm://open/'), { action: 'open' })
  assert.deepEqual(parseGllmDeepLink('gllm://open?source=g-llm'), {
    action: 'open',
    source: 'g-llm'
  })
  assert.deepEqual(parseGllmDeepLink('GLLM://OPEN/?source=g-llm'), {
    action: 'open',
    source: 'g-llm'
  })
  assert.deepEqual(parseGllmDeepLink(`gllm://open?source=g-llm&handoff=${handoffCode}`), {
    action: 'open',
    source: 'g-llm',
    handoffCode
  })
  assert.deepEqual(parseGllmDeepLink('gllm://open?source=new-api'), {
    action: 'open',
    source: 'new-api'
  })
})

test('rejects paths, credentials, fragments, ports and non-canonical encodings', () => {
  const invalidLinks = [
    'https://open?source=new-api',
    'gllm:open',
    'gllm://close',
    'gllm://open/chat',
    'gllm://open/%2e%2e',
    'gllm://user@open',
    'gllm://open:443',
    'gllm://open#chat',
    'gllm://%6fpen',
    ' gllm://open',
    'gllm://open '
  ]

  for (const link of invalidLinks) assert.equal(parseGllmDeepLink(link), null, link)
})

test('rejects unknown, duplicate, sensitive and non-whitelisted parameters', () => {
  const invalidLinks = [
    'gllm://open?',
    'gllm://open?source=',
    'gllm://open?source=website',
    'gllm://open?source=G-LLM',
    'gllm://open?source=g%2Dllm',
    'gllm://open?source=g-llm&source=g-llm',
    'gllm://open?source=g-llm&view=chat',
    'gllm://open?handoff=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'gllm://open?source=g-llm&handoff=short',
    `gllm://open?source=g-llm&handoff=${handoffCode}&api_key=secret`,
    'gllm://open?token=secret',
    'gllm://open?access_token=secret',
    'gllm://open?api_key=secret'
  ]

  for (const link of invalidLinks) assert.equal(parseGllmDeepLink(link), null, link)
})

test('redacts deep-link arguments after parsing', () => {
  const args = ['/app/G-LLM-Client', `gllm://open?source=g-llm&handoff=${handoffCode}`, '--flag']
  redactGllmDeepLinkArguments(args)
  assert.deepEqual(args, ['/app/G-LLM-Client', 'gllm://open?source=g-llm', '--flag'])
})

test('finds a link among process arguments and rejects ambiguous candidates', () => {
  assert.deepEqual(inspectGllmDeepLinkArguments(['/app/G-LLM', '--flag']), { kind: 'none' })
  assert.deepEqual(
    inspectGllmDeepLinkArguments(['/app/G-LLM-Client', '--original-process-start-time=1', 'gllm://open?source=g-llm']),
    {
      kind: 'valid',
      link: { action: 'open', source: 'g-llm' }
    }
  )
  assert.deepEqual(inspectGllmDeepLinkArguments(['/app/G-LLM', 'gllm://open?token=secret']), {
    kind: 'invalid'
  })
  assert.deepEqual(inspectGllmDeepLinkArguments(['/app/G-LLM', 'gllm://open', 'gllm://open']), {
    kind: 'invalid'
  })
})
