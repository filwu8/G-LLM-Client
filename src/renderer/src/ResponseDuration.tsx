/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { Clock3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function ResponseDuration({
  startedAt,
  completedAt,
  running
}: {
  startedAt?: number
  completedAt?: number
  running: boolean
}) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!startedAt || completedAt || !running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [completedAt, running, startedAt])

  if (!startedAt || (!completedAt && !running)) return null
  const totalSeconds = Math.max(0, Math.floor(((completedAt ?? now) - startedAt) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const duration = hours > 0
    ? t('app.durationHoursMinutesSeconds', { hours, minutes, seconds })
    : minutes > 0
      ? t('app.durationMinutesSeconds', { minutes, seconds })
      : t('app.durationSeconds', { seconds })

  return (
    <span className={`response-duration ${running && !completedAt ? 'running' : ''}`} title={t('app.responseDurationDetail')}>
      <Clock3 size={13} />
      {t(running && !completedAt ? 'app.workingElapsed' : 'app.responseDuration', { duration })}
    </span>
  )
}
