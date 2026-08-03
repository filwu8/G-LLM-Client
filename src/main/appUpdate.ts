/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { net } from 'electron'

import type { AppLanguage } from '../shared/i18n'
import type { AppUpdateInfo } from '../shared/types'
import { mainT } from './i18n'

const DOWNLOAD_PAGE_URL = 'https://llm.gprophet.com/download'
const UPDATE_ENDPOINTS = [
  'https://api.github.com/repos/filwu8/G-LLM-Client/releases/latest',
  'https://llm.gprophet.com/api/client/download',
  'https://llm.gprophet.com/api/download/config',
  'https://llm.gprophet.com/api/client-download-config',
  'https://llm.gprophet.com/api/status'
]

interface DownloadConfig {
  version: string
  releaseNotes?: string
  releaseNotesEn?: string
  updatedAt?: string
}

function normalizeVersion(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^v/i, '')
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): { numbers: number[]; prerelease: string[] } => {
    const [core, prerelease = ''] = normalizeVersion(value).split('-', 2)
    return {
      numbers: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      prerelease: prerelease ? prerelease.split('.') : []
    }
  }
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.numbers.length, b.numbers.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0)
    if (difference !== 0) return difference > 0 ? 1 : -1
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  return a.prerelease.join('.').localeCompare(b.prerelease.join('.'), undefined, { numeric: true })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseConfig(value: unknown, depth = 0): DownloadConfig | null {
  if (depth > 5) return null
  if (typeof value === 'string') {
    try {
      return parseConfig(JSON.parse(value), depth + 1)
    } catch {
      return null
    }
  }
  const record = asRecord(value)
  if (!record) return null

  const githubVersion = normalizeVersion(record.tag_name)
  if (
    githubVersion &&
    Array.isArray(record.assets) &&
    record.draft !== true &&
    record.prerelease !== true
  ) {
    return {
      version: githubVersion,
      releaseNotes: typeof record.body === 'string' ? record.body.trim() : undefined,
      updatedAt: typeof record.published_at === 'string' ? record.published_at.trim() : undefined
    }
  }

  const version = normalizeVersion(record.version ?? record.latestVersion ?? record.latest_version)
  const hasClientFields =
    'windows_url' in record || 'macos_url' in record || 'release_notes' in record || 'latestVersion' in record
  if (version && hasClientFields) {
    const localizedReleaseNotes = asRecord(record.release_notes_i18n ?? record.releaseNotesI18n)
    return {
      version,
      releaseNotes:
        typeof (record.release_notes ?? record.releaseNotes) === 'string'
          ? String(record.release_notes ?? record.releaseNotes).trim()
          : undefined,
      releaseNotesEn:
        typeof (record.release_notes_en ?? record.releaseNotesEn ?? localizedReleaseNotes?.['en-US'] ?? localizedReleaseNotes?.en) === 'string'
          ? String(record.release_notes_en ?? record.releaseNotesEn ?? localizedReleaseNotes?.['en-US'] ?? localizedReleaseNotes?.en).trim()
          : undefined,
      updatedAt:
        typeof (record.updated_at ?? record.updatedAt) === 'string'
          ? String(record.updated_at ?? record.updatedAt).trim()
          : undefined
    }
  }

  const preferredKeys = [
    'ClientDownloadConfig',
    'clientDownloadConfig',
    'client_download_config',
    'downloadConfig',
    'data',
    'options'
  ]
  for (const key of preferredKeys) {
    if (!(key in record)) continue
    const parsed = parseConfig(record[key], depth + 1)
    if (parsed) return parsed
  }
  return null
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    return await net.fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json, application/json, text/html;q=0.9',
        'User-Agent': 'G-LLM-Client-Update-Check'
      },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function readEndpointConfig(url: string): Promise<DownloadConfig | null> {
  try {
    const response = await fetchWithTimeout(url)
    if (!response.ok) return null
    return parseConfig(await response.json())
  } catch {
    return null
  }
}

function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
}

async function readDownloadPageConfig(): Promise<DownloadConfig | null> {
  try {
    const response = await fetchWithTimeout(DOWNLOAD_PAGE_URL)
    if (!response.ok) return null
    const html = await response.text()
    const jsonMatch = html.match(
      /<script[^>]+(?:id=["']gllm-client-download-config["']|type=["']application\/json["'][^>]+data-gllm-client-download)[^>]*>([\s\S]*?)<\/script>/i
    )
    if (jsonMatch) {
      const config = parseConfig(decodeHtml(jsonMatch[1].trim()))
      if (config) return config
    }
    const metaVersion = html.match(
      /<meta[^>]+(?:name|property)=["'](?:gllm-client-version|app:version)["'][^>]+content=["']([^"']+)["']/i
    )
    if (metaVersion) {
      return {
        version: normalizeVersion(metaVersion[1]),
        releaseNotes: html.match(/<meta[^>]+name=["']gllm-release-notes["'][^>]+content=["']([^"']*)["']/i)?.[1],
        releaseNotesEn: html.match(/<meta[^>]+name=["']gllm-release-notes-en["'][^>]+content=["']([^"']*)["']/i)?.[1]
      }
    }
    const installerVersion = html.match(/G-LLM[^"'<>\s]*?(\d+\.\d+\.\d+)[^"'<>\s]*?\.exe/i)
    return installerVersion ? { version: normalizeVersion(installerVersion[1]) } : null
  } catch {
    return null
  }
}

function getLocalizedReleaseNotes(config: DownloadConfig, language: AppLanguage): string | undefined {
  const releaseNotes = config.releaseNotes?.trim()
  if (mainT('main.locale', language) !== 'en-US') return releaseNotes || undefined
  if (config.releaseNotesEn?.trim()) return config.releaseNotesEn.trim()
  if (releaseNotes && !/[\u3400-\u9fff]/u.test(releaseNotes)) return releaseNotes
  return releaseNotes ? mainT('main.update.localizedNotesUnavailable', language) : undefined
}

export async function checkForAppUpdate(currentVersion: string, language: AppLanguage = 'system'): Promise<AppUpdateInfo> {
  let config: DownloadConfig | null = null
  for (const endpoint of UPDATE_ENDPOINTS) {
    config = await readEndpointConfig(endpoint)
    if (config) break
  }
  config ??= await readDownloadPageConfig()

  if (!config?.version) {
    return {
      currentVersion,
      updateAvailable: false,
      status: 'unavailable',
      automaticUpdateSupported: false,
      downloadPageUrl: DOWNLOAD_PAGE_URL,
      message: mainT('main.update.unavailable', language)
    }
  }

  const updateAvailable = compareVersions(config.version, currentVersion) > 0
  return {
    currentVersion,
    latestVersion: config.version,
    updateAvailable,
    status: updateAvailable ? 'available' : 'latest',
    automaticUpdateSupported: false,
    downloadPageUrl: DOWNLOAD_PAGE_URL,
    releaseNotes: getLocalizedReleaseNotes(config, language),
    updatedAt: config.updatedAt,
    message: updateAvailable
      ? mainT('main.update.available', language, { version: config.version })
      : mainT('main.update.latest', language, { version: currentVersion })
  }
}

export { DOWNLOAD_PAGE_URL }
