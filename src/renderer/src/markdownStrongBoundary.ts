/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

const ZERO_WIDTH_MARKDOWN_BOUNDARY = '&#8203;'
const LETTER_OR_NUMBER = /^[\p{L}\p{N}]/u

interface FenceState {
  character: '`' | '~'
  length: number
}

/**
 * CommonMark treats `**label**text` as literal text when the closing delimiter
 * touches another letter. Models produce this frequently in Chinese, where a
 * visible space would be typographically undesirable. Add an HTML entity that
 * parses as a zero-width boundary while leaving the stored message untouched.
 */
export function stabilizeAdjacentStrongDelimiters(input: string): string {
  if (!input.includes('**')) return input

  let fence: FenceState | undefined
  return input
    .split('\n')
    .map((line) => {
      const marker = readFenceMarker(line)
      if (fence) {
        if (marker && marker.character === fence.character && marker.length >= fence.length && isClosingFence(line)) {
          fence = undefined
        }
        return line
      }

      if (marker) {
        fence = marker
        return line
      }

      return stabilizeOutsideInlineCode(line)
    })
    .join('\n')
}

function stabilizeOutsideInlineCode(line: string): string {
  const inlineCode = /(`+)(.*?)\1/g
  const codeRanges = Array.from(line.matchAll(inlineCode), (match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }))
  const markers: number[] = []
  let codeRangeIndex = 0

  for (let index = 0; index < line.length; ) {
    const codeRange = codeRanges[codeRangeIndex]
    if (codeRange && index >= codeRange.start) {
      index = codeRange.end
      codeRangeIndex += 1
      continue
    }

    if (line[index] !== '*') {
      index += 1
      continue
    }

    let runEnd = index + 1
    while (line[runEnd] === '*') runEnd += 1

    if (runEnd - index === 2 && !isEscaped(line, index)) markers.push(index)
    index = runEnd
  }

  // An unmatched marker is more likely literal Markdown. Leave the whole line
  // unchanged instead of letting it affect a later, unrelated strong span.
  if (markers.length === 0 || markers.length % 2 !== 0) return line

  const closingMarkers = markers.filter((position, markerIndex) => {
    if (markerIndex % 2 === 0) return false
    return LETTER_OR_NUMBER.test(line.slice(position + 2))
  })
  if (closingMarkers.length === 0) return line

  let output = line
  for (const position of closingMarkers.reverse()) {
    output = `${output.slice(0, position + 2)}${ZERO_WIDTH_MARKDOWN_BOUNDARY}${output.slice(position + 2)}`
  }
  return output
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function readFenceMarker(line: string): FenceState | undefined {
  const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
  if (!match) return undefined

  const marker = match[1]
  return {
    character: marker[0] as '`' | '~',
    length: marker.length
  }
}

function isClosingFence(line: string): boolean {
  return /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line)
}
