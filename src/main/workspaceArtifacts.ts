/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export interface WorkspaceFileMutation {
  changedFile?: string
  changedFiles?: string[]
  supersededFiles?: string[]
}

export function explicitlyRequestsMultipleOutputs(value: string): boolean {
  return /两份|两个版本|两版|各一份|分别(?:生成|保留|输出)|保留(?:原版|原文件)|不要覆盖|不覆盖|另存为|副本|同时(?:保留|生成).{0,20}(?:版本|文件)|both\s+versions?|keep\s+(?:the\s+)?original|save\s+(?:as|a\s+copy)/iu.test(value)
}

export function resolveDocumentEnrichmentOutput(
  document: string,
  requestedOutput: string,
  keepOriginal: boolean,
  userRequest: string
): { output: string; keepOriginal: boolean } {
  const preserveOriginal = keepOriginal && explicitlyRequestsMultipleOutputs(userRequest)
  return {
    output: preserveOriginal ? requestedOutput : document,
    keepOriginal: preserveOriginal
  }
}

export function applyWorkspaceFileMutation(
  finalArtifacts: Set<string>,
  mutation: WorkspaceFileMutation
): void {
  if (mutation.changedFile) finalArtifacts.add(mutation.changedFile)
  for (const file of mutation.changedFiles ?? []) finalArtifacts.add(file)
  for (const file of mutation.supersededFiles ?? []) finalArtifacts.delete(file)
}
