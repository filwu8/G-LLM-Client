/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-07-14
 */

import { useEffect, useState } from 'react'

import type { FloatingMascotHintEvent } from '../../shared/types'

export default function FloatingMascotHint() {
  const [hint, setHint] = useState<FloatingMascotHintEvent | null>(null)

  useEffect(() => {
    void window.gllm.getFloatingMascotHint().then(setHint)
    return window.gllm.onFloatingMascotHint(setHint)
  }, [])

  if (!hint) return null

  return (
    <div className={`floating-mascot-hint ${hint.placement} ${hint.tone}`} role="status">
      <span className="floating-mascot-hint-dot" aria-hidden="true" />
      <span className="floating-mascot-hint-text">{hint.message}</span>
    </div>
  )
}
