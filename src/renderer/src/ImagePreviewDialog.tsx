/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export interface ImagePreviewSource {
  dataUrl: string
  name: string
}

export function ImagePreviewDialog({ image, onClose }: { image: ImagePreviewSource; onClose: () => void }) {
  const { t } = useTranslation()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      className="image-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section aria-label={t('app.imagePreview')} aria-modal="true" className="image-preview-dialog" role="dialog">
        <header>
          <strong title={image.name}>{image.name}</strong>
          <button aria-label={t('common.close')} onClick={onClose} type="button"><X size={19} /></button>
        </header>
        <div className="image-preview-canvas">
          <img alt={image.name} src={image.dataUrl} />
        </div>
      </section>
    </div>
  )
}
