/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const downloader = appBuilderRequire('@electron/get')

test('builder downloader validates artifacts, reuses cache and rejects tampering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gllm-download-test-'))
  const payload = Buffer.from('G-LLM build artifact verification')
  let requests = 0
  const server = createServer((request, response) => {
    requests++
    response.end(request.url === '/bad' ? Buffer.from('tampered') : payload)
  })
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const url = `http://127.0.0.1:${address.port}`
    const options = {
      version: '41.10.6',
      artifactName: 'fixture.zip',
      isGeneric: true,
      cacheRoot: join(directory, 'cache'),
      tempDirectory: directory,
      downloadOptions: { quiet: true },
      checksums: { 'fixture.zip': createHash('sha256').update(payload).digest('hex') },
      mirrorOptions: { resolveAssetURL: async () => `${url}/good` }
    }
    const file = await downloader.downloadArtifact(options)
    assert.deepEqual(await readFile(file), payload)
    const downloadedRequests = requests
    assert.equal(await downloader.downloadArtifact(options), file)
    assert.equal(requests, downloadedRequests)
    await assert.rejects(downloader.downloadArtifact({
      ...options,
      cacheMode: downloader.ElectronDownloadCacheMode.Bypass,
      mirrorOptions: { resolveAssetURL: async () => `${url}/bad` }
    }), /checksum|hash|mismatch|sum/i)
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    await rm(directory, { recursive: true, force: true })
  }
})
