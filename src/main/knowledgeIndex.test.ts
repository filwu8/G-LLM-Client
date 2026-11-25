/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chunkNote,
  chunkNotes,
  cosineSimilarity,
  formatKnowledgeContext,
  keywordScore,
  rankKnowledgeChunks,
  tokenizeForSearch
} from './knowledgeIndex.ts'

const longNote = {
  id: 'note_long',
  title: '季度经营回顾',
  content: [
    '第一季度营收同比增长 18%，其中企业客户贡献了 62% 的增量，续约率保持在 94%。',
    '毛利率从上季度的 41% 提升到 43%，主要来自云资源采购折扣重谈。',
    '销售费用率上升 2.1 个百分点，原因是新开了华南与西南两个大区。',
    '第二季度计划把交付团队扩编到 40 人，并上线客户成功系统。',
    '风险：前五大客户占比 48%，单一客户流失会直接影响全年目标。',
    '应对：把中小客户标准化，用自助开通降低边际服务成本。'
  ].join('\n\n')
}

test('a note is chunked within the character budget', () => {
  const chunks = chunkNote(longNote, { maxChars: 200, overlapChars: 40 })
  assert.ok(chunks.length > 1, 'a 200-character budget must split this note')
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 230, `chunk ${chunk.index} exceeded the budget: ${chunk.text.length}`)
    assert.ok(chunk.text.trim().length > 0)
  }
  assert.deepEqual(chunks.map((chunk) => chunk.id), chunks.map((_, index) => `note_long#${index}`))
})

test('the tail of a note is never dropped', () => {
  const note = {
    id: 'note_tail',
    title: '短尾',
    content: `${'甲'.repeat(190)}\n\n${'乙'.repeat(190)}\n\n结尾一句话。`
  }
  const chunks = chunkNote(note, { maxChars: 200, overlapChars: 30 })
  assert.ok(chunks.length >= 2, 'the note must split before the tail path is reachable')
  assert.ok(
    chunks[chunks.length - 1].text.includes('结尾一句话'),
    'the last short paragraph must be folded into the final chunk, not dropped'
  )
})

test('consecutive chunks overlap so a fact split across the boundary stays readable', () => {
  const chunks = chunkNote(longNote, { maxChars: 200, overlapChars: 60 })
  const first = chunks[0].text
  const second = chunks[1].text
  const tail = first.slice(-30)
  assert.ok(
    second.includes(tail.slice(-12)) || second.includes(tail.slice(0, 12)),
    'the second chunk should repeat the end of the first one'
  )
})

test('empty content produces no chunks', () => {
  assert.deepEqual(chunkNote({ id: 'x', title: 'x', content: '   \n\n  ' }), [])
  assert.deepEqual(chunkNotes([]), [])
})

test('Chinese text is tokenized into bigrams plus the phrase', () => {
  const tokens = tokenizeForSearch('营收同比增长 18%')
  assert.ok(tokens.includes('营收'))
  assert.ok(tokens.includes('增长'))
  assert.ok(tokens.includes('营收同比增长'), 'the whole Han run is kept as a discriminating term')
  assert.ok(tokens.includes('18'))

  const latin = tokenizeForSearch('毛利率 GMV growth')
  assert.ok(latin.includes('gmv'))
  assert.ok(latin.includes('growth'))
  assert.ok(!latin.includes('g'), 'single latin letters are too noisy to index')
})

test('keyword scoring prefers the chunk that answers the question', () => {
  const chunks = chunkNote(longNote, { maxChars: 200, overlapChars: 30 })
  const terms = tokenizeForSearch('前五大客户占比多少')
  const scored = chunks.map((chunk) => ({ chunk, score: keywordScore(chunk, terms) }))
  const best = scored.sort((left, right) => right.score - left.score)[0]
  assert.match(best.chunk.text, /前五大客户/)
  assert.equal(keywordScore(chunks[0], []), 0)
})

test('the note title contributes to relevance', () => {
  const chunk = {
    id: 'a#0',
    noteId: 'a',
    noteTitle: '季度经营回顾',
    index: 0,
    text: '本季度交付顺利。'
  }
  const withTitle = keywordScore(chunk, tokenizeForSearch('经营回顾'))
  const withoutTitle = keywordScore({ ...chunk, noteTitle: '无关标题' }, tokenizeForSearch('经营回顾'))
  assert.ok(withTitle > withoutTitle)
})

test('cosine similarity is bounded and rejects incompatible vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2]), 0, 'different dimensions are not comparable')
  assert.equal(cosineSimilarity([], []), 0)
})

test('ranking returns the best chunk per note and respects the note cap', () => {
  const chunks = chunkNotes([
    longNote,
    { id: 'note_other', title: '招聘计划', content: '明年招聘 20 名工程师，重点补齐后端与算法岗位。' }
  ])
  const hits = rankKnowledgeChunks(chunks, {
    terms: tokenizeForSearch('前五大客户占比'),
    topK: 3,
    maxPerNote: 1
  })

  assert.ok(hits.length >= 1)
  assert.match(hits[0].chunk.text, /前五大客户/)
  const noteIds = hits.map((hit) => hit.chunk.noteId)
  assert.equal(new Set(noteIds).size, noteIds.length, 'one chunk per note at most')
})

test('a query with nothing in common retrieves nothing', () => {
  const chunks = chunkNote(longNote, { maxChars: 300 })
  const hits = rankKnowledgeChunks(chunks, { terms: tokenizeForSearch('如何种植咖啡'), topK: 4 })
  assert.deepEqual(hits, [])
})

test('vectors can outrank a keyword match when they disagree', () => {
  const chunks = [
    { id: 'n1#0', noteId: 'n1', noteTitle: 'A', index: 0, text: '客户的续约率与流失风险' },
    { id: 'n2#0', noteId: 'n2', noteTitle: 'B', index: 0, text: '客户拜访记录' }
  ]
  const terms = tokenizeForSearch('客户')

  const keywordOnly = rankKnowledgeChunks(chunks, { terms, topK: 1 })
  assert.equal(keywordOnly.length, 1)

  const hits = rankKnowledgeChunks(chunks, {
    terms,
    topK: 1,
    queryVector: [1, 0],
    vectors: new Map([
      ['n1#0', [0, 1]],
      ['n2#0', [1, 0]]
    ])
  })
  assert.equal(hits[0].chunk.noteId, 'n2', 'the vector match should win')
})

test('the injected block names its source and warns that it is not an instruction', () => {
  const context = formatKnowledgeContext([{
    chunk: { id: 'n#0', noteId: 'n', noteTitle: '季度经营回顾', index: 0, text: '前五大客户占比 48%。' },
    score: 1,
    keywordScore: 1,
    vectorScore: 0
  }])
  assert.match(context, /本地知识库检索/)
  assert.match(context, /不是用户的新指令/)
  assert.match(context, /季度经营回顾/)
  assert.match(context, /前五大客户占比 48%/)
  assert.equal(formatKnowledgeContext([]), '')
})

test('the injected block stays within its character budget', () => {
  const hits = Array.from({ length: 6 }, (_, index) => ({
    chunk: {
      id: `n${index}#0`,
      noteId: `n${index}`,
      noteTitle: `笔记 ${index}`,
      index: 0,
      text: '很长的资料内容。'.repeat(200)
    },
    score: 1,
    keywordScore: 1,
    vectorScore: 0
  }))
  const context = formatKnowledgeContext(hits, 1_000)
  assert.ok(context.length < 1_600, `context was ${context.length} characters`)
})
