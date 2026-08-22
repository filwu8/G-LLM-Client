/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import type { WebSearchResult } from '../shared/types.ts'
import { buildResilientSearchPlan } from './webSearchPolicy.ts'
import {
  areResearchResultsDuplicates,
  buildResearchRecoveryAnswer,
  canonicalizeResearchUrl,
  governWebResearch,
  isAbnormalWebResearchAnswer,
  isPotentialAbnormalWebResearchAnswer,
  selectEvidencePassage
} from './webResearch.ts'

test('canonicalizes tracking links and collapses duplicate evidence', () => {
  const first: WebSearchResult = {
    title: 'Acme product announcement',
    url: 'https://www.acme.test/news?id=7&utm_source=feed#details',
    snippet: 'Acme announces its product.'
  }
  const second: WebSearchResult = {
    title: 'Acme product announcement',
    url: 'https://acme.test/news?id=7&fbclid=abc',
    snippet: 'Acme announces its product.'
  }

  assert.equal(canonicalizeResearchUrl(first.url), 'https://acme.test/news?id=7')
  assert.equal(areResearchResultsDuplicates(first, second), true)
})

test('rejects dictionary noise that does not contain the required named entity', () => {
  const query = '你知道 G-Prophet，是什么？G-Prophet 是我在股票论坛看到的'
  const plan = buildResilientSearchPlan(null, query)
  const governed = governWebResearch([
    {
      title: '知道是什么意思_百度知道',
      url: 'https://zhidao.baidu.com/question/1',
      snippet: '知道是对事物有所了解的意思。'
    },
    {
      title: 'G-Prophet research platform overview',
      url: 'https://gprophet.com/about',
      snippet: 'G-Prophet is presented as a stock research and analysis platform for investors.'
    }
  ], plan, query)

  assert.equal(governed.lowRelevanceCount, 1)
  assert.equal(governed.accepted.length, 1)
  assert.match(governed.accepted[0].title, /G-Prophet/)
  assert.equal(governed.accepted[0].sourceRole, 'primary')
})

test('rejects title-only hits that do not provide enough evidence context', () => {
  const query = 'Acme 是否值得使用？'
  const plan = buildResilientSearchPlan(null, query)
  const governed = governWebResearch([
    {
      title: 'Acme review',
      url: 'https://empty.test/acme',
      snippet: 'Acme'
    }
  ], plan, query)

  assert.equal(governed.accepted.length, 0)
  assert.equal(governed.lowRelevanceCount, 1)
})

test('filters outdated current-event evidence and incompatible platform scope', () => {
  const now = Date.UTC(2026, 7, 20)
  const currentQuery = 'Acme 最新进展'
  const currentPlan = buildResilientSearchPlan(null, currentQuery)
  const current = governWebResearch([
    {
      title: 'Acme 最新进展',
      url: 'https://old.test/acme',
      snippet: 'Acme 发布了最新版本。',
      publishedAt: now - 240 * 86_400_000
    },
    {
      title: 'Acme latest update',
      url: 'https://new.test/acme',
      snippet: 'Acme 发布了当前版本和更新说明。',
      publishedAt: now - 7 * 86_400_000
    }
  ], currentPlan, currentQuery, now)

  assert.equal(current.outdatedCount, 1)
  assert.equal(current.accepted.length, 1)

  const scopedQuery = 'Acme Windows 使用方法'
  const scopedPlan = buildResilientSearchPlan(null, scopedQuery)
  const scoped = governWebResearch([
    {
      title: 'Acme for macOS',
      url: 'https://mac.test/acme',
      snippet: 'Acme 的 macOS 版本安装与使用方法。'
    },
    {
      title: 'Acme for Windows',
      url: 'https://windows.test/acme',
      snippet: 'Acme 的 Windows 版本安装与使用方法。'
    }
  ], scopedPlan, scopedQuery)

  assert.equal(scoped.notApplicableCount, 1)
  assert.equal(scoped.accepted.length, 1)
  assert.match(scoped.accepted[0].title, /Windows/)
})

test('detects cross-source claim conflicts and creates coverage-driven supplemental queries', () => {
  const query = '核实 Acme 是否支持离线模式，是否靠谱？'
  const plan = buildResilientSearchPlan(null, query)
  const governed = governWebResearch([
    {
      title: 'Acme 离线模式说明',
      url: 'https://docs.acme.test/offline',
      snippet: 'Acme 支持离线模式，用户可以在断网时继续使用核心功能。'
    },
    {
      title: 'Acme 离线功能测试',
      url: 'https://review.test/acme-offline',
      snippet: 'Acme 不支持离线模式，用户无法在断网时继续使用核心功能。'
    }
  ], plan, query)

  assert.equal(governed.accepted.length, 2)
  assert.ok(governed.conflicts.length >= 1)
  assert.ok(governed.uncoveredQuestions.length >= 1)
  assert.ok(governed.supplementalQueries.length >= 1)
})

test('adopts complementary source roles when deep research has them available', () => {
  const query = 'Acme 是否值得使用？'
  const plan = buildResilientSearchPlan(null, query)
  const governed = governWebResearch([
    {
      title: 'Acme official product information',
      url: 'https://acme.test/product',
      snippet: 'Acme 官方介绍了产品用途、功能和限制。'
    },
    {
      title: 'Independent Acme review',
      url: 'https://review.test/acme',
      snippet: '独立测试总结了 Acme 的优势、成本与局限。'
    },
    {
      title: 'Acme user experience discussion',
      url: 'https://reddit.com/r/software/acme',
      snippet: 'Acme 用户讨论了真实使用体验和适用场景。'
    }
  ], plan, query)

  assert.deepEqual(governed.accepted.map((result) => result.sourceRole), ['primary', 'independent', 'community'])
})

test('selects a bounded evidence passage related to the research questions', () => {
  const plan = buildResilientSearchPlan(null, 'Acme 是否值得使用？')
  const result: WebSearchResult = {
    title: 'Acme review',
    url: 'https://review.test/acme',
    snippet: '导航与登录说明。',
    excerpt: 'Acme 的主要优势是快速完成分析。Acme 的局限是导出功能需要付费。其他不相关的站点导航。'
  }
  const passage = selectEvidencePassage(result, plan, 42)

  assert.ok(passage.length <= 42)
  assert.match(passage, /Acme/)
})

test('recognizes internal safety labels without rejecting a real safety analysis', () => {
  assert.equal(isAbnormalWebResearchAnswer('User Safety: safe'), true)
  assert.equal(isAbnormalWebResearchAnswer(''), true)
  assert.equal(isAbnormalWebResearchAnswer('The product appears safe for this use, but the evidence is limited.'), false)
  assert.equal(isPotentialAbnormalWebResearchAnswer('User'), true)
  assert.equal(isPotentialAbnormalWebResearchAnswer('User Safety:'), true)
  assert.equal(isPotentialAbnormalWebResearchAnswer('User Safety: safe'), true)
  assert.equal(isPotentialAbnormalWebResearchAnswer('## 结论'), false)
  assert.equal(isPotentialAbnormalWebResearchAnswer('User Safety: safe\nHere is the actual answer.'), false)
})

test('builds an attributable recovery answer instead of leaving a failed request empty', () => {
  const query = 'Acme 是否值得使用？'
  const plan = buildResilientSearchPlan(null, query)
  const results: WebSearchResult[] = [{
    title: 'Acme independent review',
    url: 'https://review.test/acme',
    snippet: '独立测试总结了 Acme 的优势、成本与局限。'
  }]
  const governed = governWebResearch(results, plan, query)
  const answer = buildResearchRecoveryAnswer(governed.accepted, plan, {
    taskType: plan.taskType,
    depth: plan.depth,
    plannerMode: plan.plannerMode,
    questions: plan.questions,
    candidateCount: governed.candidateCount,
    acceptedCount: governed.accepted.length,
    duplicateCount: governed.duplicateCount,
    outdatedCount: governed.outdatedCount,
    notApplicableCount: governed.notApplicableCount,
    lowRelevanceCount: governed.lowRelevanceCount,
    conflictCount: governed.conflicts.length,
    coveredQuestionCount: governed.coveredQuestions.length,
    totalQuestionCount: plan.questions.length,
    searchRounds: 1,
    contextCharacterBudget: plan.budget.maxContextCharacters
  })

  assert.match(answer, /模型连续两次没有生成有效正文/)
  assert.match(answer, /\[Acme independent review\]\(https:\/\/review\.test\/acme\)/)
  assert.match(answer, /检索证据摘要/)
})
