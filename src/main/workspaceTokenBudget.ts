/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 */
export interface OutputTokenBudget { encoding: 'o200k_base' | 'cl100k_base' | 'utf8-bytes'; perTool: number; perRound: number; count(text: string): number }
export function outputEncoding(model: string): OutputTokenBudget['encoding'] {
  const name = model.toLowerCase().replace(/^ft:/, '')
  if (/^(?:gpt-5|gpt-4o(?:-|$)|chatgpt-4o|gpt-4\.[15](?:-|$)|o[134](?:-|$))/.test(name)) return 'o200k_base'
  if (/^(?:gpt-4(?:-|$)|gpt-3\.5|gpt-35-turbo)/.test(name)) return 'cl100k_base'
  return 'utf8-bytes'
}
const cached = new Map<string, Promise<OutputTokenBudget>>()
/**
 * The byte fallback mirrors the token budget at 4 UTF-8 bytes per reference token,
 * which is roughly what English costs. It is a deliberately conservative proxy so a
 * model without a bundled tokenizer cannot be handed a wildly larger result than a
 * tokenized one; CJK text costs ~3 bytes per character and therefore reaches the byte
 * ceiling at about a third of the character count, which is the same order of tokens.
 *
 * These ceilings are the cost guard, not the size guard: the character ceilings in
 * workspaceOutputStore bind first for ordinary ASCII text.
 */
export async function createOutputTokenBudget(model: string): Promise<OutputTokenBudget> {
  const encoding = outputEncoding(model)
  if (encoding === 'utf8-bytes') return { encoding, perTool: 48_000, perRound: 96_000, count: text => Buffer.byteLength(text) }
  let pending = cached.get(encoding)
  if (!pending) {
    pending = (async () => {
      const [{ Tiktoken }, ranks] = await Promise.all([import('js-tiktoken/lite'), encoding === 'o200k_base' ? import('js-tiktoken/ranks/o200k_base') : import('js-tiktoken/ranks/cl100k_base')])
      const tokenizer = new Tiktoken(ranks.default)
      return { encoding, perTool: 12_000, perRound: 24_000, count: (text: string) => tokenizer.encode(text, [], []).length }
    })()
    cached.set(encoding, pending)
  }
  return pending
}
