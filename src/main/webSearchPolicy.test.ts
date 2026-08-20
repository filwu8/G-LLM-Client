/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildResilientSearchPlan,
  detectResearchTaskType,
  extractRequiredSearchEntities,
  extractSearchDomains,
  extractResearchFocus,
  extractResearchKeywords,
  getSearchAnchors,
  matchesSearchAnchors
} from './webSearchPolicy.ts'

test('turns a website evaluation request into focused research queries when model planning fails', () => {
  const plan = buildResilientSearchPlan(null, '帮我看看 www.example.com 这个软件怎么样，是否值得使用？')

  assert.equal(plan.taskType, 'evaluate')
  assert.equal(plan.depth, 'deep')
  assert.equal(plan.plannerMode, 'fallback')
  assert.equal(plan.queries.length, 4)
  assert.match(plan.queries[0], /^site:example\.com/)
  assert.ok(plan.queries.every((query) => /example/i.test(query)))
  assert.ok(plan.queries.some((query) => query.includes('评价')))
  assert.ok(plan.queries.some((query) => query.includes('风险')))
})

test('keeps only model-planned queries that preserve the requested website entity', () => {
  const plan = buildResilientSearchPlan(
    {
      intent: '评估产品是否值得使用',
      queries: ['帮 的意思', 'Example software reviews']
    },
    '请评估 https://www.example.com/ 是否值得使用'
  )

  assert.ok(!plan.queries.includes('帮 的意思'))
  assert.ok(plan.queries.includes('Example software reviews'))
})

test('extracts domain anchors and rejects unrelated search results', () => {
  assert.deepEqual(extractSearchDomains('查看 http://www.example.com/ 的产品'), ['example.com'])
  const anchors = getSearchAnchors('查看 http://www.example.com/ 的产品')

  assert.equal(matchesSearchAnchors('About Example https://www.example.com/about', anchors), true)
  assert.equal(matchesSearchAnchors('帮_百度百科：汉字的字形与读音', anchors), false)
})

test('builds distinct fallback strategies for current topics and comparisons', () => {
  const currentPlan = buildResilientSearchPlan(null, '最近生成式 AI 的监管政策有什么新进展？')
  const comparisonPlan = buildResilientSearchPlan(null, '比较 example.com 和 example.org 的隐私政策差异')

  assert.equal(detectResearchTaskType('最近有什么新进展'), 'current')
  assert.ok(currentPlan.queries.some((query) => query.includes('最新进展')))
  assert.match(comparisonPlan.queries[0], /example\.com example\.org/)
  assert.ok(comparisonPlan.queries.some((query) => query.startsWith('site:example.com')))
  assert.ok(comparisonPlan.queries.some((query) => query.startsWith('site:example.org')))
})

test('uses a compact topic instead of the conversational request wrapper', () => {
  assert.equal(extractResearchFocus('麻烦帮我查一下量子计算最近有哪些重要进展？'), '量子计算最近有哪些重要进展')
  assert.deepEqual(extractResearchKeywords('你怎么看最近的生成式 AI 监管政策进展？'), ['生成式', 'ai', '监管政策'])
})

test('preserves a hyphenated named entity and never searches the conversational word 知道', () => {
  const query = '你知道 G-Prophet，是什么？G-Prophet 是我在股票论坛看到的'
  const plan = buildResilientSearchPlan(null, query)

  assert.deepEqual(extractRequiredSearchEntities(query), ['G-Prophet'])
  assert.deepEqual(plan.requiredEntities, ['G-Prophet'])
  assert.equal(plan.depth, 'balanced')
  assert.ok(plan.queries.every((item) => /G-Prophet/i.test(item)))
  assert.ok(plan.queries.every((item) => !item.startsWith('知道')))
})

test('accepts structured planning fields while retaining deterministic entities and budgets', () => {
  const plan = buildResilientSearchPlan({
    taskType: 'verify',
    userGoal: '核验 Example 的隐私承诺是否准确',
    requiredEntities: ['Example'],
    aliases: ['Example App'],
    questions: ['官方隐私政策具体承诺了什么？', '是否存在相反证据？'],
    sourceRoles: ['primary', 'independent'],
    queries: ['Example privacy policy', 'unrelated dictionary result']
  }, '核实 https://example.com 的隐私承诺', { mode: 'model' })

  assert.equal(plan.plannerMode, 'model')
  assert.equal(plan.taskType, 'verify')
  assert.equal(plan.depth, 'deep')
  assert.ok(plan.requiredEntities.includes('example.com'))
  assert.deepEqual(plan.questions, ['官方隐私政策具体承诺了什么？', '是否存在相反证据？'])
  assert.ok(plan.queries.includes('Example privacy policy'))
  assert.ok(!plan.queries.includes('unrelated dictionary result'))
  assert.equal(plan.budget.maxRounds, 2)
})
