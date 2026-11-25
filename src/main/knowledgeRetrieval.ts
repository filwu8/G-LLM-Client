/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { ApiProvider, KnowledgeNote } from '../shared/types'
import {
  chunkNotes,
  formatKnowledgeContext,
  rankKnowledgeChunks,
  tokenizeForSearch
} from './knowledgeIndex.ts'
import { resolveProviderProtocol } from './providerProtocol.ts'

/**
 * Embedding + cache layer for knowledge retrieval. Everything here is
 * best-effort: a provider without an embedding model, a network failure, or a
 * corrupt cache file degrades to keyword retrieval instead of breaking chat.
 */

const CACHE_FILE_NAME = 'knowledge-vectors.json'
const CACHE_VERSION = 1
const MAX_CACHE_ENTRIES = 20_000
const EMBED_TIMEOUT_MS = 12_000
const EMBED_BATCH_SIZE = 24

interface VectorCacheFile {
  version: number
  vectors: Record<string, number[]>
}

let cachedVectors: Map<string, number[]> | null = null

/**
 * Chunking is pure but not free: a library of a few hundred notes would be
 * re-split on every message. Notes carry updatedAt, so a stale-entry key is
 * enough to invalidate.
 */
const chunkCache = new Map<string, { key: string; chunks: ReturnType<typeof chunkNotes> }>()

function chunksForNote(note: KnowledgeNote): ReturnType<typeof chunkNotes> {
  const key = String(note.updatedAt ?? 0)
  const cached = chunkCache.get(note.id)
  if (cached && cached.key === key) return cached.chunks
  const chunks = chunkNotes([note])
  chunkCache.set(note.id, { key, chunks })
  return chunks
}

function pruneChunkCache(activeNoteIds: Set<string>): void {
  for (const id of chunkCache.keys()) {
    if (!activeNoteIds.has(id)) chunkCache.delete(id)
  }
}

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE_NAME)
}

function textKey(model: string, text: string): string {
  // The model is part of the key: vectors from two models are not comparable,
  // and mixing them would silently produce nonsense ranking.
  return `${model}:${createHash('sha256').update(text).digest('hex').slice(0, 32)}`
}

function loadVectors(): Map<string, number[]> {
  if (cachedVectors) return cachedVectors

  const vectors = new Map<string, number[]>()
  try {
    const path = cachePath()
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as VectorCacheFile
      if (parsed?.version === CACHE_VERSION && parsed.vectors && typeof parsed.vectors === 'object') {
        for (const [key, value] of Object.entries(parsed.vectors)) {
          if (Array.isArray(value) && value.length > 0 && value.every((item) => Number.isFinite(item))) {
            vectors.set(key, value as number[])
          }
        }
      }
    }
  } catch {
    // A broken cache is not worth failing a chat over; it is rebuilt in place.
  }
  cachedVectors = vectors
  return vectors
}

function saveVectors(vectors: Map<string, number[]>): void {
  try {
    const path = cachePath()
    mkdirSync(dirname(path), { recursive: true })
    const entries = [...vectors.entries()].slice(-MAX_CACHE_ENTRIES)
    const payload: VectorCacheFile = { version: CACHE_VERSION, vectors: Object.fromEntries(entries) }
    const temporary = `${path}.tmp`
    writeFileSync(temporary, JSON.stringify(payload), 'utf8')
    renameSync(temporary, path)
  } catch {
    // Losing the cache only costs the next query an embedding call.
  }
}

export function resolveEmbeddingModel(provider: ApiProvider): string | undefined {
  return provider.models.find((model) => model.type === 'embedding')?.id
}

function embeddingRequest(
  provider: ApiProvider,
  model: string,
  texts: string[]
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null {
  const protocol = resolveProviderProtocol(provider)
  const base = provider.apiBaseUrl.replace(/\/+$/, '')

  if (protocol === 'anthropic') {
    // The Messages API has no embeddings endpoint; Anthropic points users at a
    // separate vendor. Keyword retrieval is what remains.
    return null
  }

  if (protocol === 'gemini') {
    return {
      url: `${base}/models/${encodeURIComponent(model)}:batchEmbedContents`,
      headers: {
        'content-type': 'application/json',
        ...(provider.apiKey ? { 'x-goog-api-key': provider.apiKey } : {})
      },
      body: {
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] }
        }))
      }
    }
  }

  return {
    url: `${base}/embeddings`,
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: { model, input: texts }
  }
}

function readEmbeddings(protocol: string, payload: unknown): number[][] | null {
  if (protocol === 'gemini') {
    const list = (payload as { embeddings?: Array<{ values?: unknown }> })?.embeddings
    if (!Array.isArray(list)) return null
    const vectors = list.map((item) => (Array.isArray(item?.values) ? (item.values as number[]) : []))
    return vectors.every((vector) => vector.length > 0) ? vectors : null
  }

  const list = (payload as { data?: Array<{ embedding?: unknown }> })?.data
  if (!Array.isArray(list)) return null
  const vectors = list.map((item) => (Array.isArray(item?.embedding) ? (item.embedding as number[]) : []))
  return vectors.every((vector) => vector.length > 0) ? vectors : null
}

export async function embedTexts(
  provider: ApiProvider,
  model: string,
  texts: string[],
  signal?: AbortSignal
): Promise<number[][] | null> {
  if (texts.length === 0) return []
  const request = embeddingRequest(provider, model, texts)
  if (!request) return null

  const timeoutSignal = AbortSignal.timeout(EMBED_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: combined
  })
  if (!response.ok) return null

  const vectors = readEmbeddings(resolveProviderProtocol(provider), await response.json())
  if (!vectors || vectors.length !== texts.length) return null
  return vectors
}

export interface KnowledgeRetrievalOptions {
  query: string
  notes: Array<Pick<KnowledgeNote, 'id' | 'title' | 'content' | 'updatedAt'>>
  provider: ApiProvider
  signal?: AbortSignal
  topK?: number
  maxChars?: number
}

export async function retrieveKnowledgeContext(options: KnowledgeRetrievalOptions): Promise<string> {
  const query = options.query.trim()
  if (!query || options.notes.length === 0) return ''

  pruneChunkCache(new Set(options.notes.map((note) => note.id)))
  const chunks = options.notes.flatMap((note) => chunksForNote(note as KnowledgeNote))
  if (chunks.length === 0) return ''

  const terms = tokenizeForSearch(query)
  if (terms.length === 0) return ''

  // Keyword first: it is free, and on a cold cache it decides which chunks are
  // worth spending an embedding call on.
  const shortlist = rankKnowledgeChunks(chunks, { terms, topK: 48, maxPerNote: 48, minScore: 0 })
  const vectors = new Map(loadVectors())
  let queryVector: number[] | undefined

  const model = resolveEmbeddingModel(options.provider)
  if (model && shortlist.length > 0) {
    try {
      const [embeddedQuery] = (await embedTexts(options.provider, model, [query], options.signal)) ?? []
      if (embeddedQuery) {
        queryVector = embeddedQuery
        const missing = shortlist
          .slice(0, EMBED_BATCH_SIZE)
          .filter((hit) => !vectors.has(textKey(model, hit.chunk.text)))
        if (missing.length > 0) {
          const embedded = await embedTexts(
            options.provider,
            model,
            missing.map((hit) => hit.chunk.text),
            options.signal
          )
          if (embedded) {
            missing.forEach((hit, index) => {
              const vector = embedded[index]
              if (vector && vector.length === embeddedQuery.length) {
                vectors.set(textKey(model, hit.chunk.text), vector)
              }
            })
            saveVectors(vectors)
          }
        }
      }
    } catch (error) {
      options.signal?.throwIfAborted()
      // Fall through to keyword-only ranking.
      queryVector = undefined
    }
  }

  const keyed = new Map<string, number[]>()
  for (const chunk of chunks) {
    const vector = model ? vectors.get(textKey(model, chunk.text)) : undefined
    if (vector) keyed.set(chunk.id, vector)
  }

  const hits = rankKnowledgeChunks(chunks, {
    terms,
    vectors: keyed,
    queryVector,
    topK: options.topK ?? 4
  })
  return formatKnowledgeContext(hits, options.maxChars ?? 5_000)
}

/** Test seam: drops the in-memory copy so the next read hits the file again. */
export function resetKnowledgeVectorCache(): void {
  cachedVectors = null
}
