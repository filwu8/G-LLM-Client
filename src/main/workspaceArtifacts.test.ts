/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyWorkspaceFileMutation,
  explicitlyRequestsMultipleOutputs,
  resolveDocumentEnrichmentOutput
} from './workspaceArtifacts.ts'

test('requires an explicit request before retaining multiple output variants', () => {
  assert.equal(explicitlyRequestsMultipleOutputs('帮我生成一个带 Logo 的 Word 文档'), false)
  assert.equal(explicitlyRequestsMultipleOutputs('原版和带 Logo 版各一份'), true)
  assert.equal(explicitlyRequestsMultipleOutputs('Keep the original and save a copy with the logo'), true)
})

test('tracks final artifacts while removing superseded intermediate files', () => {
  const artifacts = new Set<string>()
  applyWorkspaceFileMutation(artifacts, { changedFile: 'draft.docx' })
  applyWorkspaceFileMutation(artifacts, {
    changedFile: 'final.docx',
    supersededFiles: ['draft.docx']
  })

  assert.deepEqual([...artifacts], ['final.docx'])
})

test('forces document enrichment to update one file unless the user requests variants', () => {
  assert.deepEqual(
    resolveDocumentEnrichmentOutput('通知.docx', '通知_含Logo.docx', true, '生成一个带 Logo 的 Word'),
    { output: '通知.docx', keepOriginal: false }
  )
  assert.deepEqual(
    resolveDocumentEnrichmentOutput('通知.docx', '通知_含Logo.docx', true, '原版和带 Logo 版各一份'),
    { output: '通知_含Logo.docx', keepOriginal: true }
  )
})
