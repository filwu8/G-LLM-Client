/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export const DEFAULT_PROJECT_ID = 'project_default'

/**
 * Which project a record belongs to, mirroring the store's own rule: an absent
 * id means the default project, not "belongs to nobody".
 */
export function belongsToProject(
  recordProjectId: string | undefined | null,
  projectId: string,
  fallback = DEFAULT_PROJECT_ID
): boolean {
  return (String(recordProjectId ?? '').trim() || fallback) === projectId
}

/**
 * Drop every record owned by `projectId`.
 *
 * Deleting a project used to remove only the project row, leaving its
 * conversations, notes and memories orphaned in the store forever: invisible in
 * the UI (no project to open them from) yet still written on each save. Records
 * with no project id belong to the default project and must survive.
 */
export function withoutProjectRecords<T extends { projectId?: string }>(
  records: readonly T[],
  projectId: string,
  fallback = DEFAULT_PROJECT_ID
): T[] {
  return records.filter((record) => !belongsToProject(record.projectId, projectId, fallback))
}

/**
 * Same purge for keys stored as `"${projectId}:${id}"` (assistant orders and
 * the list of deleted built-in assistants).
 */
export function withoutProjectKeys(
  keys: readonly string[],
  projectId: string,
  fallback = DEFAULT_PROJECT_ID
): string[] {
  return keys.filter((key) => {
    const separator = key.indexOf(':')
    const keyProjectId = separator >= 0 ? key.slice(0, separator) : key
    return !belongsToProject(keyProjectId, projectId, fallback)
  })
}
