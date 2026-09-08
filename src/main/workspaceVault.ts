/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { normalizeEnvNames, selectWorkspaceEnvironment } from './workspaceAgentPolicy.ts'

export interface VariableDeclaration { name: string; description: string }
export interface VariableStatus extends VariableDeclaration { configured: boolean }
export interface VaultCrypto { available(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
interface VaultData { declarations: VariableDeclaration[]; values: Record<string, string> }
export function validateDeclarations(input: unknown): VariableDeclaration[] {
  if (!Array.isArray(input) || input.length > 32) throw new Error('Declare at most 32 variables')
  const names = input.map(item => item?.name)
  if (normalizeEnvNames(names).length !== names.length) throw new Error('Invalid or duplicate variable names')
  // Reuse the runtime-control denylist before accepting a variable.
  selectWorkspaceEnvironment(Object.fromEntries(names.map(name => [name, ''])), names)
  return input.map(item => ({ name: item.name, description: String(item.description ?? '').slice(0, 240) }))
}
export class WorkspaceVault {
  private queue: Promise<unknown> = Promise.resolve()
  private directory: string
  private crypto: VaultCrypto
  constructor(directory: string, crypto: VaultCrypto) { this.directory = directory; this.crypto = crypto }
  private async path(root: string) {
    const canonical = await realpath(root)
    return resolve(this.directory, createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex') + '.json')
  }
  private async read(root: string): Promise<VaultData> {
    try {
      const text = await readFile(await this.path(root), 'utf8')
      const data = JSON.parse(text) as VaultData
      return { declarations: validateDeclarations(data.declarations), values: Object.assign(Object.create(null), data.values ?? {}) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { declarations: [], values: Object.create(null) }; throw error }
  }
  private async save(root: string, data: VaultData) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const path = await this.path(root), temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(data), { mode: 0o600, flag: 'wx' })
    await rename(temp, path)
  }
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => {})
    return next
  }
  async status(root: string) {
    await this.queue
    const data = await this.read(root)
    return { encryptionAvailable: this.crypto.available(), variables: data.declarations.map(item => ({ ...item, configured: Object.hasOwn(data.values, item.name) })) }
  }
  declare(root: string, input: unknown) {
    const declarations = validateDeclarations(input)
    return this.mutate(async () => {
      const data = await this.read(root)
      const merged = new Map(data.declarations.map(item => [item.name, item]))
      declarations.forEach(item => merged.set(item.name, item))
      data.declarations = validateDeclarations([...merged.values()])
      await this.save(root, data)
      return data.declarations.map(item => ({ ...item, configured: Object.hasOwn(data.values, item.name) }))
    })
  }
  update(root: string, input: unknown) {
    if (!Array.isArray(input)) throw new Error('Invalid variable updates')
    validateDeclarations(input)
    const updates = input as Array<VariableDeclaration & { value?: string; remove?: boolean }>
    if (updates.some(item => item.value !== undefined && (typeof item.value !== 'string' || item.value.length > 16384))) throw new Error('Invalid variable value')
    return this.mutate(async () => {
      if (!this.crypto.available()) throw new Error('OS credential encryption is unavailable; plaintext storage is disabled')
      const data = await this.read(root)
      const declarations = new Map(data.declarations.map(item => [item.name, item]))
      for (const item of updates) {
        if (item.remove) { delete data.values[item.name]; declarations.delete(item.name); continue }
        declarations.set(item.name, { name: item.name, description: String(item.description ?? '').slice(0, 240) })
        if (item.value !== undefined) data.values[item.name] = this.crypto.encrypt(item.value).toString('base64')
      }
      data.declarations = validateDeclarations([...declarations.values()])
      await this.save(root, data)
    })
  }
  async values(root: string, names: string[]) {
    await this.queue
    const data = await this.read(root), result: Record<string, string> = Object.create(null)
    for (const name of normalizeEnvNames(names)) {
      if (!Object.hasOwn(data.values, name)) continue
      if (!this.crypto.available()) throw new Error('OS credential encryption is unavailable')
      try { result[name] = this.crypto.decrypt(Buffer.from(data.values[name], 'base64')) }
      catch { throw new Error(`Stored variable ${name} could not be decrypted; enter it again in Agent settings`) }
    }
    return result
  }
}
