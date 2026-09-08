/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
import { createHash, randomUUID } from 'node:crypto'
export const TOOL_OUTPUT_CHARACTERS = 12_000
export const TOOL_ROUND_CHARACTERS = 24_000
export function integerOption(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Expected an integer from ${min} to ${max}`)
  return value
}
export function safeTextEnd(text: string, end: number): number {
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) return end - 1
  return end
}
interface StoredOutput { id: string; text: string; bytes: number; digest: string }
/** Redacted results only. Scoped to one agent run, never shared or persisted. */
export class WorkspaceOutputStore {
  private outputs = new Map<string, StoredOutput>()
  private calls = new Map<string, string>()
  private bytes = 0
  private maxBytes: number
  private maxItems: number
  private measure: (text: string) => number
  constructor(maxBytes = 8 * 1024 * 1024, maxItems = 128, measure: (text: string) => number = text => text.length) { this.maxBytes = maxBytes; this.maxItems = maxItems; this.measure = measure }
  capture(callId: string, text: string, budget = TOOL_OUTPUT_CHARACTERS, tokenBudget = Infinity) {
    const bytes = Buffer.byteLength(text)
    if (text.length <= 1600 && text.length <= budget && this.measure(text) <= tokenBudget) return { output: text, originalCharacters: text.length, sentCharacters: text.length }
    if (bytes > this.maxBytes) {
      const output = this.preview(text, budget, tokenBudget, '[Not retained: result exceeds the per-run archive limit. Narrow the read/search. Do not repeat a side-effecting command to recover output.]')
      return { output, originalCharacters: text.length, sentCharacters: output.length }
    }
    const id = randomUUID(), entry = { id, text, bytes, digest: createHash('sha256').update(text).digest('hex').slice(0, 16) }
    this.outputs.set(id, entry); this.calls.set(callId, id); this.bytes += bytes
    while (this.bytes > this.maxBytes || this.outputs.size > this.maxItems) {
      const first = this.outputs.entries().next().value!
      this.outputs.delete(first[0]); this.bytes -= first[1].bytes
      for (const [call, stored] of this.calls) if (stored === first[0]) this.calls.delete(call)
    }
    const output = text.length > budget || this.measure(text) > tokenBudget ? this.preview(text, budget, tokenBudget, this.reference(id)!) : text
    return { output, originalCharacters: text.length, sentCharacters: output.length }
  }
  private preview(text: string, budget: number, tokenBudget: number, reference: string) {
    let remaining = Math.max(0, budget - reference.length - 96)
    while (true) {
      const front = safeTextEnd(text, Math.floor(remaining * 0.7)), tailLength = Math.floor(remaining * 0.3)
      let tail = text.length - tailLength
      if (tail > 0 && /[\uDC00-\uDFFF]/.test(text[tail])) tail++
      const output = `[Partial tool output; middle omitted]\n${text.slice(0, front)}\n[… omitted …]\n${text.slice(tail)}\n${reference}`
      if (output.length <= budget && this.measure(output) <= tokenBudget) return output
      if (remaining === 0) throw new Error('Output budget cannot hold the recovery reference')
      remaining = Math.floor(remaining * 0.75)
    }
  }
  reference(id: string): string | undefined {
    const entry = this.outputs.get(id)
    if (!entry) return undefined
    return `[Retained output: ${entry.text.length} UTF-16 characters; sha256=${entry.digest}. Recover without rerunning: read_tool_output ${JSON.stringify({ id, offset: 0, maxCharacters: 8000 })}. Valid only during this run.]`
  }
  referenceForCall(callId: string): string | undefined { const id = this.calls.get(callId); return id ? this.reference(id) : undefined }
  read(args: Record<string, unknown>, responseBudget = TOOL_OUTPUT_CHARACTERS, tokenBudget = Infinity): string {
    const entry = this.outputs.get(String(args.id ?? ''))
    if (!entry) throw new Error('Output unavailable or evicted from this run. Do not automatically rerun a command that may have side effects.')
    const offset = integerOption(args.offset, 0, 0, entry.text.length)
    if (offset > 0 && /[\uDC00-\uDFFF]/.test(entry.text[offset])) throw new Error('Offset splits a Unicode character; use the exact continuation offset')
    const max = integerOption(args.maxCharacters, 8000, 256, 12000)
    let end = safeTextEnd(entry.text, Math.min(entry.text.length, offset + max))
    const render = () => JSON.stringify({ id: entry.id, offset, end, totalCharacters: entry.text.length, content: entry.text.slice(offset, end), complete: end === entry.text.length, next: end < entry.text.length ? { id: entry.id, offset: end, maxCharacters: max } : null })
    let result = render()
    while ((result.length > responseBudget || this.measure(result) > tokenBudget) && end > offset) { end = safeTextEnd(entry.text, offset + Math.floor((end - offset) * 0.8)); result = render() }
    if (end === offset && offset < entry.text.length) throw new Error('Output budget too small to make progress')
    return result
  }
}
