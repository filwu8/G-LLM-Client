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

export function resolveTimeZone(timeZone: string | undefined): string {
  if (!timeZone || timeZone === 'system') {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return timeZone
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }
}

export function getTimeZoneOffset(timeZone: string, timestamp = Date.now()): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset'
  }).formatToParts(timestamp).find((item) => item.type === 'timeZoneName')?.value
  return (part || 'GMT').replace('GMT', 'UTC')
}

export function getTimeZoneOptionLabel(timeZone: string): string {
  return `${timeZone.replace(/_/g, ' ')} (${getTimeZoneOffset(timeZone)})`
}

export function formatMessageTimestamp(timestamp: number, locale: string, configuredTimeZone: string | undefined) {
  const timeZone = resolveTimeZone(configuredTimeZone)
  const visibleParts = new Intl.DateTimeFormat('en-CA', {
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
  const full = new Intl.DateTimeFormat(locale, {
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

  return {
    short: `${visibleTime} · ${getTimeZoneOffset(timeZone, timestamp)}`,
    full: `${full} · ${timeZone}`,
    iso: new Date(timestamp).toISOString()
  }
}
