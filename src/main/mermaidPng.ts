/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import { BrowserWindow, clipboard, nativeImage } from 'electron'
import { randomUUID } from 'node:crypto'

import { getMermaidCaptureTiles, getMermaidPngDimensions, normalizeMermaidSvg } from '../shared/mermaidSvg.ts'
import { createSerialTaskQueue } from '../shared/serialTaskQueue.ts'

const MAX_MERMAID_SVG_LENGTH = 20 * 1024 * 1024
const enqueuePngCopy = createSerialTaskQueue()

function validateMermaidSvg(value: unknown): string {
  const svg = typeof value === 'string' ? value.trim() : ''
  if (!svg.toLowerCase().startsWith('<svg') || svg.length > MAX_MERMAID_SVG_LENGTH) {
    throw new Error('Invalid Mermaid SVG data')
  }
  if (/<script\b|\bon[a-z]+\s*=|javascript\s*:/i.test(svg)) {
    throw new Error('Mermaid SVG contains unsupported active content')
  }
  return normalizeMermaidSvg(svg)
}

export function copyMermaidSvgAsPng(value: unknown): Promise<void> {
  return enqueuePngCopy(() => copyMermaidSvgAsPngNow(value))
}

function jsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

async function copyMermaidSvgAsPngNow(value: unknown): Promise<void> {
  let stage = 'validate'
  let svg = ''
  let width = 0
  let height = 0
  let window: BrowserWindow | undefined
  let captureSize: { width: number; height: number } | undefined
  let captureScaleFactors: number[] | undefined
  let capturePngSize: { width: number; height: number } | undefined
  let contentSize: number[] | undefined
  let windowBounds: Electron.Rectangle | undefined
  let tileCount = 0

  try {
    svg = validateMermaidSvg(value)
    stage = 'measure'
    ;({ width, height } = getMermaidPngDimensions(svg))
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; object-src 'none'; frame-src 'none'; base-uri 'none'">`

    stage = 'create-window'
    window = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      useContentSize: true,
      width,
      height,
      webPreferences: {
        partition: `mermaid-png-${randomUUID()}`,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: { deviceScaleFactor: 1 },
        sandbox: true
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const scheme = details.url.split(':', 1)[0]?.toLowerCase()
      callback({ cancel: scheme !== 'data' && scheme !== 'about' })
    })

    stage = 'load-document'
    await window.loadURL('about:blank')
    contentSize = window.getContentSize()
    windowBounds = window.getBounds()
    const [viewportWidth, viewportHeight] = contentSize
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) || viewportWidth < 1 || viewportHeight < 1) {
      throw new Error('Could not create a valid Mermaid capture viewport')
    }
    const style = `html,body{box-sizing:border-box;margin:0;padding:0;width:${viewportWidth}px;height:${viewportHeight}px;overflow:hidden;background:transparent}body>svg{position:absolute!important;left:0!important;top:0!important;display:block!important;width:${width}px!important;height:${height}px!important;max-width:none!important;transform-origin:0 0!important}`

    stage = 'render-svg'
    await window.webContents.executeJavaScript(
      `document.head.innerHTML = ${jsStringLiteral(`${policy}<style>${style}</style>`)}; document.body.innerHTML = ${jsStringLiteral(svg)}; true`
    )
    await window.webContents.executeJavaScript(
      `(() => { const canvas = document.createElement('canvas'); canvas.width = ${width}; canvas.height = ${height}; canvas.style.display = 'none'; const context = canvas.getContext('2d'); if (!context) throw new Error('Could not create the Mermaid output canvas'); document.body.appendChild(canvas); window.__mermaidPngExport = { svg: document.body.querySelector(':scope > svg'), canvas, context }; return Boolean(window.__mermaidPngExport.svg); })()`
    )
    stage = 'wait-for-render'
    await window.webContents.executeJavaScript(
      'document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))'
    )
    stage = 'capture'
    const tiles = getMermaidCaptureTiles(width, height, viewportWidth, viewportHeight)
    tileCount = tiles.length
    for (const tile of tiles) {
      await window.webContents.executeJavaScript(
        `window.__mermaidPngExport.svg.style.setProperty('transform', ${jsStringLiteral(`translate(${-tile.x}px, ${-tile.y}px)`)}, 'important'); new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
      )

      const image = await window.webContents.capturePage(
        { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
        { stayHidden: true }
      )
      if (image.isEmpty()) throw new Error(`Could not render Mermaid image tile at ${tile.x},${tile.y}`)

      const actualSize = image.getSize()
      captureSize = actualSize
      captureScaleFactors = image.getScaleFactors()
      const scaleX = actualSize.width / viewportWidth
      const scaleY = actualSize.height / viewportHeight
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0 || Math.abs(scaleX - scaleY) > 0.01) {
        const png = image.toPNG({ scaleFactor: 1 })
        capturePngSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
        throw new Error(`The captured Mermaid tile is incomplete or distorted (viewport ${viewportWidth}x${viewportHeight}, received ${actualSize.width}x${actualSize.height})`)
      }

      const tileDataUrl = `data:image/png;base64,${image.toPNG({ scaleFactor: 1 }).toString('base64')}`
      await window.webContents.executeJavaScript(
        `(async () => { const state = window.__mermaidPngExport; const image = new Image(); image.src = ${jsStringLiteral(tileDataUrl)}; await image.decode(); state.context.drawImage(image, 0, 0, ${tile.width * scaleX}, ${tile.height * scaleY}, ${tile.x}, ${tile.y}, ${tile.width}, ${tile.height}); return true; })()`
      )
    }

    stage = 'write-clipboard'
    const outputDataUrl = await window.webContents.executeJavaScript(
      'window.__mermaidPngExport.canvas.toDataURL("image/png")'
    )
    const outputImage = nativeImage.createFromDataURL(outputDataUrl)
    if (outputImage.isEmpty()) throw new Error('Could not create the complete Mermaid PNG image')
    const outputPng = outputImage.toPNG({ scaleFactor: 1 })
    const outputSize = { width: outputPng.readUInt32BE(16), height: outputPng.readUInt32BE(20) }
    if (outputSize.width !== width || outputSize.height !== height) {
      throw new Error(`The final Mermaid image has the wrong size (expected ${width}x${height}, received ${outputSize.width}x${outputSize.height})`)
    }
    clipboard.writeImage(outputImage)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Mermaid PNG] Export failed.', {
      stage,
      svgLength: svg.length,
      expectedSize: { width, height },
      captureSize,
      captureScaleFactors,
      capturePngSize,
      contentSize,
      windowBounds,
      tileCount,
      error: message
    })
    throw error
  } finally {
    if (window && !window.isDestroyed()) window.destroy()
  }
}
