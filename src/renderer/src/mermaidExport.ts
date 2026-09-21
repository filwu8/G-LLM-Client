/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { getMermaidPngDimensions, normalizeMermaidSvg } from '../../shared/mermaidSvg.ts'

export { getMermaidCaptureTiles, getMermaidPngDimensions, getSvgDimensions, normalizeMermaidSvg } from '../../shared/mermaidSvg.ts'

export function svgNeedsBrowserCapture(svg: string): boolean {
  return /<foreignObject\b/i.test(svg)
}

export async function svgToPngDataUrl(svg: string): Promise<string> {
  const source = normalizeMermaidSvg(svg)
  const sourceUrl = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }))
  const image = new Image()

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not render the Mermaid diagram as an image'))
      image.src = sourceUrl
    })

    const { width, height } = getMermaidPngDimensions(source)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create an image canvas')
    context.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}
