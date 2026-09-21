/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { getMermaidCaptureTiles, getMermaidPngDimensions, getSvgDimensions, normalizeMermaidSvg, svgNeedsBrowserCapture } from './mermaidExport.ts'

test('gets Mermaid SVG dimensions from explicit width and height attributes', () => {
  assert.deepEqual(getSvgDimensions('<svg width="640px" height="480px"/>'), { width: 640, height: 480 })
})

test('uses the viewBox when SVG dimensions are percentages', () => {
  assert.deepEqual(getSvgDimensions('<svg width="100%" height="auto" viewBox="0 0 320 180"/>'), { width: 320, height: 180 })
})

test('ignores child SVG element dimensions when sizing the full Mermaid viewBox', () => {
  const svg = '<svg viewBox="0 0 1600 900"><foreignObject width="180" height="40"><div>label</div></foreignObject></svg>'
  assert.deepEqual(getSvgDimensions(svg), { width: 1600, height: 900 })
  assert.deepEqual(getMermaidPngDimensions(svg), { width: 3200, height: 1800 })
})

test('uses the viewBox aspect ratio when root SVG dimensions disagree', () => {
  const svg = '<svg width="1600" height="240" viewBox="0 0 1600 900"><rect width="1200" height="800"/></svg>'
  assert.deepEqual(getSvgDimensions(svg), { width: 1600, height: 900 })
  assert.deepEqual(getMermaidPngDimensions(svg), { width: 3200, height: 1800 })
})

test('applies a safe fallback when an SVG omits dimensions', () => {
  assert.deepEqual(getSvgDimensions('<svg/>'), { width: 1024, height: 768 })
})

test('does not mistake a root stroke-width attribute for the SVG width', () => {
  assert.deepEqual(getSvgDimensions('<svg stroke-width="4" height="300"><rect width="80" height="20"/></svg>'), {
    width: 1024,
    height: 300
  })
})

test('sizes PNG output from the complete diagram viewBox, independent of the visible viewport', () => {
  assert.deepEqual(getMermaidPngDimensions('<svg width="100%" height="100%" viewBox="0 0 1800 900"/>'), {
    width: 3600,
    height: 1800
  })
})

test('bounds large PNG output while preserving the complete diagram aspect ratio', () => {
  assert.deepEqual(getMermaidPngDimensions('<svg viewBox="0 0 8000 4000"/>'), {
    width: 4096,
    height: 2048
  })
})

test('splits a large Mermaid image into viewport-sized capture tiles', () => {
  assert.deepEqual(getMermaidCaptureTiles(3252, 2748, 1907, 946), [
    { x: 0, y: 0, width: 1907, height: 946 },
    { x: 1907, y: 0, width: 1345, height: 946 },
    { x: 0, y: 946, width: 1907, height: 946 },
    { x: 1907, y: 946, width: 1345, height: 946 },
    { x: 0, y: 1892, width: 1907, height: 856 },
    { x: 1907, y: 1892, width: 1345, height: 856 }
  ])
})

test('uses one capture tile when a Mermaid image fits the viewport', () => {
  assert.deepEqual(getMermaidCaptureTiles(800, 600, 1907, 946), [
    { x: 0, y: 0, width: 800, height: 600 }
  ])
})

test('adds an SVG namespace when the rendered Mermaid markup does not contain one', () => {
  assert.equal(
    normalizeMermaidSvg('<svg viewBox="0 0 10 10"></svg>'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
  )
})

test('preserves a Mermaid SVG namespace that is already present', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
  assert.equal(normalizeMermaidSvg(svg), svg)
})

test('detects SVG diagrams with HTML labels that need full-document Chromium rendering', () => {
  assert.equal(svgNeedsBrowserCapture('<svg><foreignObject><div>label</div></foreignObject></svg>'), true)
  assert.equal(svgNeedsBrowserCapture('<svg><text>label</text></svg>'), false)
})
