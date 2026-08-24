/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

const automaticallyRetryableStatuses = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527
])

export type ChatErrorMessageKey =
  | 'errors.modelTimeout'
  | 'errors.modelBusy'
  | 'errors.modelUnavailable'
  | 'errors.modelAbnormal'
  | 'errors.requestFailed'

export interface ChatErrorClassification {
  raw: string
  status?: number
  automaticallyRetryable: boolean
  messageKey?: ChatErrorMessageKey
}

function getHttpStatus(value: string): number | undefined {
  const labeledMatch = value.match(/(?:请求失败[：:]?|HTTP|error\s+code|status(?:\s+code)?)[^\d]{0,12}(\d{3})\b/i)
  if (labeledMatch) return Number(labeledMatch[1])

  // The main process intentionally emits friendly errors such as
  // “模型服务发生临时故障（500）”. Recognize that form without scanning opaque
  // request IDs for arbitrary three-digit sequences.
  const parenthesizedMatch = value.match(/[（(]\s*(408|425|429|500|502|503|504|520|521|522|523|524|525|526|527)\s*[）)]/)
  return parenthesizedMatch ? Number(parenthesizedMatch[1]) : undefined
}

export function classifyChatError(value: string): ChatErrorClassification {
  const raw = value.trim()
  const status = getHttpStatus(raw)
  const isHtml = /<!doctype\s+html|<html[\s>]/i.test(raw)
  const looksLikeNetworkFailure = /fetch failed|network|econn|enotfound|etimedout|socket|连接.*(?:失败|异常|超时)|网络.*(?:失败|异常|超时)|timeout/i.test(raw)
  const looksLikeUpstreamFailure = /upstream error|do[_ ]request[_ ]failed|g_llm_error|模型服务.*(?:临时故障|暂时不可用)|模型网关.*上游/i.test(raw)
  const automaticallyRetryable =
    (status !== undefined && automaticallyRetryableStatuses.has(status)) ||
    (!status && (looksLikeNetworkFailure || looksLikeUpstreamFailure))

  let messageKey: ChatErrorMessageKey | undefined
  if (status === 524) messageKey = 'errors.modelTimeout'
  else if (status === 429) messageKey = 'errors.modelBusy'
  else if (automaticallyRetryable) messageKey = 'errors.modelUnavailable'
  else if (isHtml) messageKey = 'errors.modelAbnormal'
  else if (!raw) messageKey = 'errors.requestFailed'

  return { raw, status, automaticallyRetryable, messageKey }
}
