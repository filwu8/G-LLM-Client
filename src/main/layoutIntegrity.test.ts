import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// A single long line in a message (a JSON blob pasted into a code block, a
// minified log, a base64 payload) used to widen the whole chat panel: the grid
// track sized itself to the widest content, the composer stretched with it, and
// the model picker ended up thousands of pixels to the right, clipped by the
// panel's overflow. These assertions pin the declarations that keep the track at
// the window width and hand the overflow to the code block instead.
//
// Media queries describe the deliberately stacked small-screen layout, so they
// are stripped first: what matters here is the desktop rule set, which the app
// window (1100px minimum) always uses.
function withoutMediaQueries(css: string): string {
  let out = ''
  let index = 0
  while (index < css.length) {
    const at = css.indexOf('@media', index)
    if (at === -1) {
      out += css.slice(index)
      break
    }
    out += css.slice(index, at)
    const open = css.indexOf('{', at)
    assert.ok(open !== -1, 'unterminated @media block in styles.css')
    let depth = 0
    let cursor = open
    for (; cursor < css.length; cursor += 1) {
      if (css[cursor] === '{') depth += 1
      else if (css[cursor] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    index = cursor + 1
  }
  return out
}

const stylesheet = withoutMediaQueries(readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8'))

function ruleBody(selector: string): string {
  const pattern = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
  const match = stylesheet.match(pattern)
  assert.ok(match, `${selector} must be declared in styles.css`)
  return match[1]
}

test('the chat panel clamps its column so long content cannot widen it', () => {
  const body = ruleBody('.chat-panel')
  assert.match(
    body,
    /grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)/,
    'an auto column sizes to its widest item, which lets one long line push the composer controls off screen'
  )
})

test('the message viewport may shrink below its content width', () => {
  const body = ruleBody('.message-viewport')
  assert.match(
    body,
    /min-width:\s*0/,
    'a flex/grid item defaults to min-width auto, so it would still resist shrinking to the panel width'
  )
})

test('long code lines scroll inside the block instead of overflowing the panel', () => {
  const body = ruleBody('.markdown-body pre')
  assert.match(body, /overflow-x:\s*auto/, 'the block needs its own horizontal scrollbar')
  assert.match(body, /white-space:\s*pre\b/, 'code must not be re-wrapped to fit')
})

// The composer toolbar is where the window width runs out first: at the 1100px
// minimum the tool row alone is ~345px. Letting it wrap moved the model picker
// and the send button onto a second line, which reads as a broken layout rather
// than a narrow one. The model name truncates instead.
test('the composer toolbar keeps one row and its controls keep their size', () => {
  assert.match(ruleBody('.composer-toolbar'), /flex-wrap:\s*nowrap/)

  const send = ruleBody('.send-button')
  assert.match(send, /flex:\s*0\s+0\s+auto/, 'a shrinkable send button loses its shape when space runs out')
  assert.match(send, /width:\s*36px/, 'the send button was reduced to give the model name room')

  const modelName = ruleBody('.composer-model-picker .model-dropdown-current strong')
  assert.match(modelName, /max-width:\s*100%/, 'without a width cap the name is clipped instead of ellipsised')
})

// Paid and free models used to be spelled out next to the model name. The words
// are gone from the toolbar, so the colour of the name is now the only visual
// difference -- if both rules ever collapse to the same colour the distinction
// disappears silently.
test('the model name colour still tells paid from free', () => {
  const paid = ruleBody('.composer-model-picker .model-current-name.tier-paid')
  const free = ruleBody('.composer-model-picker .model-current-name.tier-free')
  const shell = /hsl\(var\((--[\w-]+)\)\)/
  const paidColor = paid.match(shell)?.[1]
  const freeColor = free.match(shell)?.[1]
  assert.ok(paidColor, 'the paid tier must set a colour on the name')
  assert.ok(freeColor, 'the free tier must set a colour on the name')
  assert.notEqual(paidColor, freeColor, 'paid and free must not share a colour')
})
