/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDocxDocument } from './docxDocument.ts'
import {
  assertRequestedArtifactContract,
  getRequestedArtifactContract,
  requestsNativeWordTable,
  verifyWorkspaceArtifacts
} from './workspaceArtifactVerification.ts'

test('distinguishes a requested table from a request to remove tables', () => {
  assert.equal(requestsNativeWordTable('生成一个包含报价表格的 Word 文档'), true)
  assert.equal(requestsNativeWordTable('生成 Word 文档，但不要表格，把内容改成段落'), false)
  assert.equal(requestsNativeWordTable('Summarize the table without creating a document'), false)
})

test('requires a real editable Word table when the request asks for one', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gllm-artifact-verification-'))
  const tableDocument = await createDocxDocument('报价', '| 项目 | 金额 |\n| --- | --- |\n| 设计 | 12000 |', 'G-LLM')
  writeFileSync(join(root, '报价.docx'), tableDocument.buffer)

  const result = await verifyWorkspaceArtifacts(root, new Set(['报价.docx']), '生成一个包含报价表格的 Word 文档')
  assert.equal(result.verifiedFiles, 1)
  assert.equal(result.docxTables, 1)
})

test('rejects pipe-delimited text disguised as a requested Word table', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gllm-artifact-verification-'))
  const plainDocument = await createDocxDocument('报价', '项目 | 金额\n设计 | 12000', 'G-LLM')
  writeFileSync(join(root, '报价.docx'), plainDocument.buffer)

  await assert.rejects(
    verifyWorkspaceArtifacts(root, new Set(['报价.docx']), '生成一个包含报价表格的 Word 文档'),
    /没有原生可编辑表格/
  )
})

test('requires exactly the requested PDF and forbids an extra Word deliverable', () => {
  const request = '生成“员工培训通知.pdf”。这次只需要 PDF，不要同时保留 Word。'
  assert.deepEqual(getRequestedArtifactContract(request), {
    requiredExtensions: ['.pdf'],
    forbiddenExtensions: ['.docx'],
    expectedFileNames: ['员工培训通知.pdf'],
    singleOutput: false
  })
  assert.doesNotThrow(() => assertRequestedArtifactContract(new Set(['员工培训通知.pdf']), request))
  assert.throws(
    () => assertRequestedArtifactContract(new Set(['员工培训通知.docx']), request),
    /明确需要 \.pdf/
  )
})

test('requires one native Word output when PDF is explicitly rejected', () => {
  const request = '生成“员工培训通知.docx”。用户明确要求 Word，因此不要转换为 PDF，也不要生成预览版或草稿版。只生成一个最终文件。'
  assert.deepEqual(getRequestedArtifactContract(request), {
    requiredExtensions: ['.docx'],
    forbiddenExtensions: ['.pdf'],
    expectedFileNames: ['员工培训通知.docx'],
    singleOutput: true
  })
  assert.throws(
    () => assertRequestedArtifactContract(new Set(['员工培训通知.docx', '员工培训通知.pdf']), request),
    /明确不要 \.pdf/
  )
})
