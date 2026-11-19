/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

const intlWithSupportedValues = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[]
}

const supportedTimeZones = intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney'
]

export const TIME_ZONE_OPTIONS = ['UTC', ...supportedTimeZones.filter((timeZone) => timeZone !== 'UTC')]

/*
 * Building an Intl.DateTimeFormat costs far more than formatting with one, and the
 * chat transcript re-formats every visible timestamp on each keystroke. Both the
 * formatter instances and the formatted strings are cached; callers only read the
 * result, so sharing one object is safe.
 */
const DATE_TIME_FORMAT_LIMIT = 64
const TIMESTAMP_LIMIT = 600
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()
const resolvedTimeZones = new Map<string, string>()
const formattedTimestamps = new Map<string, MessageTimestamp>()

function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${options.timeZone ?? ''}|${options.timeZoneName ?? ''}|${options.year ?? ''}|${options.month ?? ''}|${options.day ?? ''}|${options.hour ?? ''}|${options.minute ?? ''}|${options.second ?? ''}|${options.hourCycle ?? ''}`
  const cached = dateTimeFormats.get(key)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat(locale, options)
  if (dateTimeFormats.size >= DATE_TIME_FORMAT_LIMIT) dateTimeFormats.clear()
  dateTimeFormats.set(key, formatter)
  return formatter
}

/**
 * Shared cache for callers that format many dates per render (message rows,
 * sidebar entries). Constructing an Intl.DateTimeFormat is the expensive part.
 */
export function cachedDateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return dateTimeFormat(locale, options)
}

function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function resolveTimeZone(timeZone: string | undefined): string {
  const cacheKey = timeZone ?? ''
  const cached = resolvedTimeZones.get(cacheKey)
  if (cached) return cached

  let resolved: string
  if (!timeZone || timeZone === 'system') {
    resolved = systemTimeZone()
  } else {
    try {
      dateTimeFormat('en-US', { timeZone }).format(0)
      resolved = timeZone
    } catch {
      resolved = systemTimeZone()
    }
  }
  if (resolvedTimeZones.size >= 32) resolvedTimeZones.clear()
  resolvedTimeZones.set(cacheKey, resolved)
  return resolved
}

export function getTimeZoneOffset(timeZone: string, timestamp = Date.now()): string {
  const part = dateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset'
  }).formatToParts(timestamp).find((item) => item.type === 'timeZoneName')?.value
  return (part || 'GMT').replace('GMT', 'UTC')
}

export function getTimeZoneOptionLabel(timeZone: string): string {
  return `${timeZone.replace(/_/g, ' ')} (${getTimeZoneOffset(timeZone)})`
}

export interface MessageTimestamp {
  short: string
  full: string
  iso: string
}

export function formatMessageTimestamp(timestamp: number, locale: string, configuredTimeZone: string | undefined): MessageTimestamp {
  const cacheKey = `${timestamp}|${locale}|${configuredTimeZone ?? ''}`
  const cached = formattedTimestamps.get(cacheKey)
  if (cached) return cached

  const timeZone = resolveTimeZone(configuredTimeZone)
  const visibleParts = dateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone
  }).formatToParts(timestamp)
  const visiblePart = (type: Intl.DateTimeFormatPartTypes) =>
    visibleParts.find((part) => part.type === type)?.value ?? ''
  const visibleTime = `${visiblePart('year')}-${visiblePart('month')}-${visiblePart('day')} ${visiblePart('hour')}:${visiblePart('minute')}`
  const full = dateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
    timeZoneName: 'longOffset'
  }).format(timestamp)

  const result: MessageTimestamp = {
    short: `${visibleTime} · ${getTimeZoneOffset(timeZone, timestamp)}`,
    full: `${full} · ${timeZone}`,
    iso: new Date(timestamp).toISOString()
  }
  if (formattedTimestamps.size >= TIMESTAMP_LIMIT) formattedTimestamps.clear()
  formattedTimestamps.set(cacheKey, result)
  return result
}
