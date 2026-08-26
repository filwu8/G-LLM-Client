/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

const INLINE_DELIMITERS = ['**', '__', '~~'] as const

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function isFenceLine(value: string, index: number, marker: string): boolean {
  const lineStart = value.lastIndexOf('\n', index - 1) + 1
  return value.slice(lineStart, index).trim().length === 0 && value.startsWith(marker, index)
}

function canOpenDelimiter(value: string, index: number, delimiter: string): boolean {
  const next = value[index + delimiter.length]
  return Boolean(next && !/\s/.test(next))
}

function canCloseDelimiter(value: string, index: number): boolean {
  const previous = value[index - 1]
  return Boolean(previous && !/\s/.test(previous))
}

/**
 * Keep an unfinished inline Markdown token visually stable while text is
 * streaming. React Markdown otherwise treats an opening marker as literal
 * text and then changes the whole run to formatted text once the closing
 * marker arrives. In a narrow window that font-width change can make several
 * lines jump. The synthetic closers are display-only and never enter the
 * stored conversation.
 */
export function stabilizeStreamingMarkdown(input: string): string {
  if (!input) return input

  const openDelimiters: string[] = []
  let fenceMarker = ''
  let inlineCodeMarker = ''

  for (let index = 0; index < input.length;) {
    if (!inlineCodeMarker && !isEscaped(input, index)) {
      const fence = input.startsWith('```', index) ? '```' : input.startsWith('~~~', index) ? '~~~' : ''
      if (fence && isFenceLine(input, index, fence)) {
        if (!fenceMarker) fenceMarker = fence
        else if (fenceMarker === fence) fenceMarker = ''
        index += fence.length
        continue
      }
    }

    if (fenceMarker) {
      index += 1
      continue
    }

    if (input[index] === '`' && !isEscaped(input, index)) {
      let runLength = 1
      while (input[index + runLength] === '`') runLength += 1
      const marker = '`'.repeat(runLength)
      if (!inlineCodeMarker) inlineCodeMarker = marker
      else if (inlineCodeMarker === marker) inlineCodeMarker = ''
      index += runLength
      continue
    }

    if (inlineCodeMarker) {
      index += 1
      continue
    }

    const delimiter = INLINE_DELIMITERS.find((candidate) => input.startsWith(candidate, index))
    if (!delimiter || isEscaped(input, index)) {
      index += 1
      continue
    }

    const activeIndex = openDelimiters.lastIndexOf(delimiter)
    if (activeIndex >= 0 && canCloseDelimiter(input, index)) {
      openDelimiters.splice(activeIndex, 1)
    } else if (canOpenDelimiter(input, index, delimiter)) {
      openDelimiters.push(delimiter)
    }
    index += delimiter.length
  }

  if (fenceMarker) return input

  const closers = [...openDelimiters].reverse()
  if (inlineCodeMarker) closers.unshift(inlineCodeMarker)
  return closers.length > 0 ? `${input}${closers.join('')}` : input
}
