/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { getSvgDimensions, normalizeMermaidSvg } from './mermaidExport.ts'

test('gets Mermaid SVG dimensions from explicit width and height attributes', () => {
  assert.deepEqual(getSvgDimensions('<svg width="640px" height="480px"/>'), { width: 640, height: 480 })
})

test('uses the viewBox when SVG dimensions are percentages', () => {
  assert.deepEqual(getSvgDimensions('<svg width="100%" height="auto" viewBox="0 0 320 180"/>'), { width: 320, height: 180 })
})

test('applies a safe fallback when an SVG omits dimensions', () => {
  assert.deepEqual(getSvgDimensions('<svg/>'), { width: 1024, height: 768 })
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
