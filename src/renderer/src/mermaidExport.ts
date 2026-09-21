/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export interface SvgDimensions {
  width: number
  height: number
}

const MAX_PNG_EDGE = 4096
const MAX_PNG_SCALE = 2

function numericSvgAttribute(svg: string, name: string): number | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']+)\\1`, 'i').exec(svg)
  if (!match) return undefined
  const rawValue = match[2].trim()
  if (rawValue.endsWith('%')) return undefined
  const value = Number.parseFloat(rawValue)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function getSvgDimensions(svg: string): SvgDimensions {
  const viewBoxMatch = /\bviewBox\s*=\s*(["'])([^"']+)\1/i.exec(svg)
  const viewBoxValues = viewBoxMatch?.[2].trim().split(/[\s,]+/).map(Number) ?? []
  const viewBoxWidth = viewBoxValues.length === 4 && Number.isFinite(viewBoxValues[2]) && viewBoxValues[2] > 0
    ? viewBoxValues[2]
    : undefined
  const viewBoxHeight = viewBoxValues.length === 4 && Number.isFinite(viewBoxValues[3]) && viewBoxValues[3] > 0
    ? viewBoxValues[3]
    : undefined

  return {
    width: numericSvgAttribute(svg, 'width') ?? viewBoxWidth ?? 1024,
    height: numericSvgAttribute(svg, 'height') ?? viewBoxHeight ?? 768
  }
}

export function normalizeMermaidSvg(svg: string): string {
  if (/\bxmlns\s*=/.test(svg.slice(0, svg.indexOf('>') + 1))) return svg
  return svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
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

    const dimensions = getSvgDimensions(source)
    const scale = Math.min(MAX_PNG_SCALE, MAX_PNG_EDGE / dimensions.width, MAX_PNG_EDGE / dimensions.height)
    const width = Math.max(1, Math.round(dimensions.width * scale))
    const height = Math.max(1, Math.round(dimensions.height * scale))
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
