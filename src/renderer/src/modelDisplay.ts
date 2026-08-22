/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import type { ProviderModel } from '@shared/types'

export function getCompactModelTitle(model: ProviderModel): string {
  const configuredName = model.name?.trim()
  if (configuredName && configuredName !== model.id && configuredName.length <= 28) return configuredName

  const leafName = model.id.split('/').at(-1)?.replace(/:free$/i, '') || configuredName || model.id
  const words = leafName.split(/[-_\s]+/).filter(Boolean)
  const detailIndex = words.findIndex(
    (word, index) => index >= 3 && /^(?:omni|reasoning|thinking|instruct|chat|preview|latest)$/i.test(word)
  )
  const compactWords = words.slice(0, detailIndex >= 0 ? detailIndex : 4)

  return compactWords
    .map((word) => {
      if (/^gpt$/i.test(word)) return 'GPT'
      if (/^[a-z]+$/i.test(word)) return `${word[0].toUpperCase()}${word.slice(1)}`
      return word.toUpperCase()
    })
    .join(' ')
}
