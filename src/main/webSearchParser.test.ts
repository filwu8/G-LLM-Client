/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isBlockedGoogleSearchHtml,
  parseDuckDuckGoSearchResults,
  parseGoogleSearchResults
} from './webSearchParser.ts'

test('parses DuckDuckGo result links, snippets, entities, and target domains', () => {
  const html = `
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1&amp;rut=tracking">
        Example &amp; Product <b>documentation</b>
      </a>
      <a class="result__snippet">The <b>official</b> guide &amp; API reference.</a>
    </div>
    <div class="result">
      <a rel="nofollow" class="result__a" href="https://independent.test/review">Independent review</a>
      <div class="result__snippet">A separate test with limitations and context.</div>
    </div>`

  const results = parseDuckDuckGoSearchResults(html)
  assert.equal(results.length, 2)
  assert.deepEqual(results[0], {
    title: 'Example & Product documentation',
    url: 'https://example.com/docs?a=1',
    snippet: 'The official guide & API reference.',
    sourceDomain: 'example.com'
  })
  assert.equal(results[1].sourceDomain, 'independent.test')
})

test('parses accessible Google result pages and recognizes blocked responses', () => {
  const html = `
    <div class="MjjYud">
      <a href="/url?sa=t&amp;url=https%3A%2F%2Fexample.com%2Fofficial%3Fv%3D2"><h3>Example Official</h3></a>
      <div class="VwiC3b yXK7lf">Official product details &amp; current documentation.</div>
    </div>
    <div class="MjjYud">
      <a href="https://independent.test/example"><h3><span>Independent review</span></h3></a>
      <div class="IsZvec">An independent review with scope and limitations.</div>
    </div>`
  const results = parseGoogleSearchResults(html)

  assert.equal(results.length, 2)
  assert.deepEqual(results[0], {
    title: 'Example Official',
    url: 'https://example.com/official?v=2',
    snippet: 'Official product details & current documentation.',
    sourceDomain: 'example.com'
  })
  assert.equal(isBlockedGoogleSearchHtml('<a href="/httpservice/retry/enablejs?emsg=SG_REL">启用 JavaScript</a>'), true)
  assert.deepEqual(parseGoogleSearchResults('<html>Our systems have detected unusual traffic</html>'), [])
})
