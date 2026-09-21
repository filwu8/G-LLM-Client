/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

export interface SvgDimensions {
  width: number
  height: number
}

export interface MermaidCaptureTile extends SvgDimensions {
  x: number
  y: number
}

const MAX_PNG_EDGE = 4096
const MAX_PNG_SCALE = 2

function numericSvgAttribute(svg: string, name: string): number | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([^"']+)\\1`, 'i').exec(svg)
  if (!match) return undefined
  const rawValue = match[2].trim()
  if (rawValue.endsWith('%')) return undefined
  const value = Number.parseFloat(rawValue)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function getSvgDimensions(svg: string): SvgDimensions {
  const rootTag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ''
  const viewBoxMatch = /(?:^|\s)viewBox\s*=\s*(["'])([^"']+)\1/i.exec(rootTag)
  const viewBoxValues = viewBoxMatch?.[2].trim().split(/[\s,]+/).map(Number) ?? []
  const viewBoxWidth = viewBoxValues.length === 4 && Number.isFinite(viewBoxValues[2]) && viewBoxValues[2] > 0
    ? viewBoxValues[2]
    : undefined
  const viewBoxHeight = viewBoxValues.length === 4 && Number.isFinite(viewBoxValues[3]) && viewBoxValues[3] > 0
    ? viewBoxValues[3]
    : undefined

  return {
    width: viewBoxWidth ?? numericSvgAttribute(rootTag, 'width') ?? 1024,
    height: viewBoxHeight ?? numericSvgAttribute(rootTag, 'height') ?? 768
  }
}

export function getMermaidPngDimensions(svg: string): SvgDimensions {
  const dimensions = getSvgDimensions(svg)
  const scale = Math.min(MAX_PNG_SCALE, MAX_PNG_EDGE / dimensions.width, MAX_PNG_EDGE / dimensions.height)
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale))
  }
}

export function getMermaidCaptureTiles(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number
): MermaidCaptureTile[] {
  const dimensions = [width, height, viewportWidth, viewportHeight]
  if (dimensions.some((value) => !Number.isFinite(value) || value < 1)) {
    throw new Error('Mermaid image and capture viewport dimensions must be positive numbers')
  }

  const tiles: MermaidCaptureTile[] = []
  for (let y = 0; y < height; y += viewportHeight) {
    const tileHeight = Math.min(viewportHeight, height - y)
    for (let x = 0; x < width; x += viewportWidth) {
      tiles.push({
        x,
        y,
        width: Math.min(viewportWidth, width - x),
        height: tileHeight
      })
    }
  }
  return tiles
}

export function normalizeMermaidSvg(svg: string): string {
  if (/\bxmlns\s*=/.test(svg.slice(0, svg.indexOf('>') + 1))) return svg
  return svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
}
