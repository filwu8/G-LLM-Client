/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

'use strict'

const { copyFile, mkdir, readFile, readdir, realpath, rename, stat, writeFile } = require('node:fs/promises')
const { isAbsolute, relative, resolve } = require('node:path')
const vm = require('node:vm')

const rootInput = process.argv[2]
const scriptPath = process.argv[3]
const MAX_TEXT_BYTES = 10 * 1024 * 1024
const MAX_BINARY_BYTES = 25 * 1024 * 1024

if (!rootInput || !scriptPath) throw new Error('缺少工作区或脚本路径')

function isInside(child, root) {
  const diff = relative(root, child)
  return diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))
}

async function existingPath(root, input = '.') {
  const target = await realpath(resolve(root, String(input || '.')))
  if (!isInside(target, root)) throw new Error(`路径超出工作区：${input}`)
  return target
}

async function writablePath(root, input) {
  const target = resolve(root, String(input || ''))
  const parent = await realpath(resolve(target, '..'))
  if (!isInside(target, root) || !isInside(parent, root)) throw new Error(`路径超出工作区：${input}`)
  return target
}

async function walk(root, start, recursive, limit = 2000) {
  const pending = [start]
  const result = []
  while (pending.length && result.length < limit) {
    const current = pending.shift()
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.gllm') continue
      const full = resolve(current, entry.name)
      result.push({
        path: relative(root, full),
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'
      })
      if (recursive && entry.isDirectory()) pending.push(full)
      if (result.length >= limit) break
    }
    if (!recursive) break
  }
  return result
}

async function main() {
  const root = await realpath(rootInput)
  const source = await readFile(scriptPath, 'utf8')
  const logs = []
  const log = (...values) => {
    if (logs.length < 200) logs.push(values.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ').slice(0, 2000))
  }
  const workspace = Object.freeze({
    platform: process.platform,
    list: async (path = '.', options = {}) => walk(root, await existingPath(root, path), Boolean(options.recursive), Math.min(5000, Math.max(1, Number(options.limit) || 2000))),
    stat: async (path) => {
      const target = await existingPath(root, path)
      const info = await stat(target)
      return { path: relative(root, target) || '.', type: info.isDirectory() ? 'directory' : 'file', size: info.size, modifiedAt: info.mtime.toISOString() }
    },
    readText: async (path) => {
      const target = await existingPath(root, path)
      const info = await stat(target)
      if (info.size > MAX_TEXT_BYTES) throw new Error(`文本文件超过 ${MAX_TEXT_BYTES} 字节：${path}`)
      return readFile(target, 'utf8')
    },
    writeText: async (path, content) => {
      const text = String(content)
      if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new Error(`写入内容超过 ${MAX_TEXT_BYTES} 字节：${path}`)
      const target = await writablePath(root, path)
      await writeFile(target, text, { encoding: 'utf8', flag: 'w' })
      return { path: relative(root, target), size: Buffer.byteLength(text) }
    },
    readBase64: async (path) => {
      const target = await existingPath(root, path)
      const info = await stat(target)
      if (info.size > MAX_BINARY_BYTES) throw new Error(`二进制文件超过 ${MAX_BINARY_BYTES} 字节：${path}`)
      return (await readFile(target)).toString('base64')
    },
    writeBase64: async (path, content) => {
      const data = Buffer.from(String(content), 'base64')
      if (data.length > MAX_BINARY_BYTES) throw new Error(`写入内容超过 ${MAX_BINARY_BYTES} 字节：${path}`)
      const target = await writablePath(root, path)
      await writeFile(target, data, { flag: 'w' })
      return { path: relative(root, target), size: data.length }
    },
    mkdir: async (path) => {
      const target = resolve(root, String(path || ''))
      if (!isInside(target, root)) throw new Error(`路径超出工作区：${path}`)
      await mkdir(target, { recursive: true })
      return relative(root, target)
    },
    copy: async (from, to) => {
      const sourcePath = await existingPath(root, from)
      const targetPath = await writablePath(root, to)
      await copyFile(sourcePath, targetPath)
      return relative(root, targetPath)
    },
    move: async (from, to) => {
      const sourcePath = await existingPath(root, from)
      const targetPath = await writablePath(root, to)
      await rename(sourcePath, targetPath)
      return relative(root, targetPath)
    }
  })
  const sandbox = vm.createContext({
    workspace,
    console: Object.freeze({ log, info: log, warn: log, error: log }),
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    Blob,
    CompressionStream,
    DecompressionStream,
    JSON,
    Math,
    Date,
    RegExp,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout
  }, { codeGeneration: { strings: false, wasm: false } })
  const wrapped = `(async () => {\n${source}\n})()`
  const result = await new vm.Script(wrapped, { filename: 'gllm-workspace-script.js' }).runInContext(sandbox, { timeout: 10_000 })
  process.stdout.write(`${JSON.stringify({ ok: true, result: result === undefined ? null : result, logs })}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
