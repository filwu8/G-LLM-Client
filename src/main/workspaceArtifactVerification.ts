/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'
import { loadImage } from '@napi-rs/canvas'
import mammoth from 'mammoth'

import { inspectDocxBuffer } from './docxDocument.ts'

export interface RequestedArtifactContract {
  requiredExtensions: string[]
  forbiddenExtensions: string[]
  expectedFileNames: string[]
  singleOutput: boolean
}

function withoutNegatedFormat(value: string, format: RegExp): string {
  return value.replace(new RegExp(`(?:不要|无需|不需要|禁止|不得|别|without|do\\s+not|don't|no)[^。；;\\n]{0,48}(?:${format.source})`, 'giu'), '')
}

function explicitlyNegatesFormat(value: string, format: RegExp): boolean {
  return new RegExp(`(?:不要|无需|不需要|禁止|不得|别|without|do\\s+not|don't|no)[^。；;\\n]{0,48}(?:${format.source})`, 'iu').test(value)
}

function positivelyRequestsFormat(value: string, format: RegExp): boolean {
  const positiveText = withoutNegatedFormat(value, format)
  return new RegExp(`(?:生成|创建|制作|输出|导出|转换为|转成|保存为|交付|需要|要求|generate|create|export|convert|save|deliver|need|require)[^。；;\\n]{0,60}(?:${format.source})|(?:${format.source})[^。；;\\n]{0,32}(?:文件|文档|file|document)`, 'iu').test(positiveText)
}

export function getRequestedArtifactContract(value: string): RequestedArtifactContract {
  const pdf = '(?:pdf|\\.pdf)'
  const word = '(?:word|docx|\\.docx)'
  const pdfPattern = new RegExp(pdf, 'iu')
  const wordPattern = new RegExp(word, 'iu')
  const expectedFileNames = Array.from(value.matchAll(/[“"'「『]([^”"'」』\n]+?\.(?:docx|pdf))[”"'」』]/giu))
    .map((match) => basename(match[1].trim()))
  const expectedExtensions = expectedFileNames.map((file) => extname(file).toLocaleLowerCase())
  const onlyPdf = new RegExp(`(?:只(?:需要|要|生成|交付|输出|保留)|only)[^。；;\\n]{0,36}${pdf}`, 'iu').test(value)
  const onlyWord = new RegExp(`(?:只(?:需要|要|生成|交付|输出|保留)|only)[^。；;\\n]{0,36}${word}`, 'iu').test(value)
  const requiredExtensions = [
    ...(expectedExtensions.includes('.pdf') || positivelyRequestsFormat(value, pdfPattern) ? ['.pdf'] : []),
    ...(expectedExtensions.includes('.docx') || positivelyRequestsFormat(value, wordPattern) ? ['.docx'] : [])
  ]
  const forbiddenExtensions = [
    ...(explicitlyNegatesFormat(value, pdfPattern) || onlyWord ? ['.pdf'] : []),
    ...(explicitlyNegatesFormat(value, wordPattern) || onlyPdf ? ['.docx'] : [])
  ].filter((extension) => !requiredExtensions.includes(extension))
  const explicitlyMultiple = /两份|两个版本|两版|各一份|分别(?:生成|保留|输出)|both\s+versions?|two\s+(?:files|versions?)/iu.test(value)
  const singleOutput = !explicitlyMultiple && /只(?:生成|交付|输出|保留)(?:一个|一份)|一个最终文件|单个最终文件|only\s+(?:one|a\s+single)|single\s+final\s+file/iu.test(value)

  return {
    requiredExtensions: [...new Set(requiredExtensions)],
    forbiddenExtensions: [...new Set(forbiddenExtensions)],
    expectedFileNames: [...new Set(expectedFileNames)],
    singleOutput
  }
}

export function assertRequestedArtifactContract(
  artifacts: Set<string>,
  latestUserRequest: string
): RequestedArtifactContract {
  const contract = getRequestedArtifactContract(latestUserRequest)
  const files = [...artifacts]
  const extensions = files.map((file) => extname(file).toLocaleLowerCase())
  for (const required of contract.requiredExtensions) {
    if (!extensions.includes(required)) {
      throw new Error(`产物格式不符合要求：用户明确需要 ${required} 文件，但本轮没有生成`)
    }
  }
  for (const forbidden of contract.forbiddenExtensions) {
    if (extensions.includes(forbidden)) {
      throw new Error(`产物格式不符合要求：用户明确不要 ${forbidden} 文件，但本轮仍生成了该格式`)
    }
  }
  for (const expected of contract.expectedFileNames) {
    if (!files.some((file) => basename(file) === expected)) {
      throw new Error(`产物文件名不符合要求：缺少 ${expected}`)
    }
  }
  if (contract.singleOutput && files.length !== 1) {
    throw new Error(`产物数量不符合要求：用户只需要一个最终文件，本轮实际得到 ${files.length} 个`)
  }
  return contract
}

export function requestsNativeWordTable(value: string): boolean {
  if (!/表格|\btable\b/i.test(value)) return false
  if (/(?:不要|无需|不需要|移除|删除|去掉).{0,12}表格|(?:without|no|remove|delete)\s+(?:an?\s+|the\s+)?table/i.test(value)) {
    return false
  }
  return /(?:生成|创建|制作|输出|插入|添加|包含|带有|使用).{0,60}表格|表格.{0,60}(?:word|docx|文档|生成|创建|制作|输出|插入|添加)|(?:create|generate|include|insert|add|with).{0,60}\btable\b|\btable\b.{0,30}\b(?:in|into|to|for)\b.{0,30}(?:word|docx|document)/i.test(value)
}

async function resolveVerifiedArtifact(root: string, artifact: string): Promise<string> {
  const rootPath = await realpath(root)
  const target = await realpath(resolve(rootPath, artifact))
  const diff = relative(rootPath, target)
  if (diff.startsWith('..') || isAbsolute(diff)) throw new Error(`产物验证失败：${artifact} 不在工作区内`)
  return target
}

export async function verifyWorkspaceArtifacts(
  root: string,
  artifacts: Set<string>,
  latestUserRequest: string
): Promise<{ verifiedFiles: number; docxTables: number }> {
  let docxTables = 0
  for (const artifact of artifacts) {
    const target = await resolveVerifiedArtifact(root, artifact)
    const info = await stat(target)
    if (!info.isFile() || info.size === 0) throw new Error(`产物验证失败：${artifact} 不是有效的非空文件`)

    const extension = extname(target).toLocaleLowerCase()
    if (extension === '.docx') {
      const buffer = await readFile(target)
      const structure = await inspectDocxBuffer(buffer)
      const text = (await mammoth.extractRawText({ buffer })).value
      if (!text.trim()) throw new Error(`产物验证失败：${artifact} 没有可读取的 Word 正文`)
      docxTables += structure.tableCount
      if (requestsNativeWordTable(latestUserRequest) && structure.tableCount === 0) {
        throw new Error(`产物验证失败：用户要求 Word 表格，但 ${artifact} 中没有原生可编辑表格`)
      }
      continue
    }
    if (extension === '.pdf') {
      const signature = (await readFile(target)).subarray(0, 5).toString('ascii')
      if (signature !== '%PDF-') throw new Error(`产物验证失败：${artifact} 不是有效的 PDF 文件`)
      continue
    }
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) {
      const image = await loadImage(await readFile(target))
      if (!image.width || !image.height) throw new Error(`产物验证失败：${artifact} 不是可读取的图片`)
    }
  }
  return { verifiedFiles: artifacts.size, docxTables }
}
