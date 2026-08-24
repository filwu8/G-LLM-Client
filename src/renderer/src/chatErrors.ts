/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { rendererI18n } from './i18n'
import { classifyChatError } from './chatErrorPolicy'

export interface ChatErrorPresentation {
  userMessage: string
  technicalDetail: string
  automaticallyRetryable: boolean
}

export function getChatErrorPresentation(value: string): ChatErrorPresentation {
  const classification = classifyChatError(value)
  const userMessage = classification.messageKey
    ? rendererI18n.t(classification.messageKey)
    : classification.raw

  return {
    userMessage,
    technicalDetail: classification.status
      ? `HTTP ${classification.status}\n${classification.raw}`
      : classification.raw,
    automaticallyRetryable: classification.automaticallyRetryable
  }
}
