/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { parseEnv } from 'node:util'

export function isProtectedWorkspacePath(path: string): boolean {
  return path.split(/[\\/]/).some((part) => /^(?:\.env(?:\..*)?|\.ssh|\.aws|\.gnupg|\.git|id_rsa|id_ed25519)$/i.test(part) && !/^\.env\.(?:example|sample|template)$/i.test(part))
}

export function assertWorkspacePathAllowed(path: string): void {
  if (isProtectedWorkspacePath(path)) throw new Error('Protected credentials or repository metadata cannot be accessed by workspace file tools')
}

// Only explicit, small regular files at the selected root. Never source .env as code.
async function readRootConfig(root: string, name: string, limit: number): Promise<string | undefined> {
  const rootReal = await realpath(root)
  const path = resolve(rootReal, name)
  let file
  try {
    const target = await realpath(path)
    const diff = relative(rootReal, target)
    if (target !== path || isAbsolute(diff) || diff.startsWith('..')) throw new Error(`${name}: symbolic links are not supported`)
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await file.stat()
    if (!info.isFile() || info.size > limit) throw new Error(`${name}: expected a regular file of at most ${limit} bytes`)
    const buffer = Buffer.alloc(limit + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > limit) throw new Error(`${name}: file is too large`)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  } finally {
    await file?.close()
  }
}

export async function loadWorkspaceInstructions(root: string): Promise<string | undefined> {
  return readRootConfig(root, 'AGENTS.md', 32_768)
}

export async function loadWorkspaceEnvironment(root: string): Promise<Record<string, string>> {
  const source = await readRootConfig(root, '.env', 65_536)
  return source === undefined ? {} : Object.fromEntries(Object.entries(parseEnv(source)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

export function normalizeEnvNames(names: unknown): string[] {
  if (!Array.isArray(names)) return []
  return [...new Set(names.filter((name): name is string => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)))].slice(0, 32)
}

export function selectWorkspaceEnvironment(values: Record<string, string>, names: string[]): Record<string, string> {
  const selected: Record<string, string> = Object.create(null)
  for (const name of normalizeEnvNames(names)) {
    // Loader/startup controls are not business credentials.
    if (/^(?:PATH|PATHEXT|HOME|SHELL|ENV|BASH_ENV|IFS|CDPATH|NODE_OPTIONS|NODE_PATH|ELECTRON_.*|PYTHON.*|LD_.*|DYLD_.*|COMSPEC|SYSTEMROOT|WINDIR|SYSTEMDRIVE|LOCALAPPDATA|PSMODULEPATH|PSMODULEANALYSISCACHEPATH|TEMP|TMP|TMPDIR)$/i.test(name)) {
      throw new Error(`Environment variable ${name} controls the runtime and cannot be injected`)
    }
    if (!Object.hasOwn(values, name)) throw new Error(`Environment variable ${name} is missing; configure it in Agent settings or .env`)
    selected[name] = values[name]
  }
  return selected
}

export function redactWorkspaceSecrets(text: string, values: Record<string, string>): string {
  let result = text
  for (const secret of [...new Set(Object.values(values))].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join('[REDACTED]')
  }
  return result
}

export function needsWorkspaceApproval(
  mode: string | undefined,
  isScript: boolean,
  canWrite: boolean,
  isNative = false,
  boundary: { executionMode?: 'sandbox' | 'host'; external?: boolean } = {}
): boolean {
  if (mode === 'full') return false
  // Decide by enforced execution boundaries, never by guessing what script text does.
  // Unknown native boundaries ask; the caller must explicitly supply sandbox mode.
  if (mode === 'auto') return boundary.external === true || (isNative && boundary.executionMode !== 'sandbox')
  return isScript || canWrite || isNative || boundary.external === true
}

export function workspaceApprovalInstructions(mode: string | undefined): string {
  const policy = mode === 'full'
    ? 'Full authorization: enabled tools execute without per-operation approval, including explicitly enabled host execution and HTTP extensions.'
    : mode === 'auto'
      ? 'Approve for me: workspace tools, restricted JavaScript and configured sandbox Python/Shell (including background jobs) execute automatically. Host commands and HTTP extensions require approval.'
      : 'Ask for approval: file writes, scripts and HTTP extensions require per-operation approval; read-only workspace tools execute directly.'
  return `${policy} Approval mode does not enable disabled tools, expand workspace permissions, enable networking or variables, or change sandbox/host mode. The client enforces approvals; invoke the appropriate tool instead of asking the user to approve again in chat. Batch replacements still require a preview and version checks in every mode.`
}

export async function loadWorkspaceEnvExampleNames(root: string): Promise<string[]> {
  const content = await readRootConfig(root, '.env.example', 65536)
  return normalizeEnvNames(Object.keys(parseEnv(content ?? '')))
}
