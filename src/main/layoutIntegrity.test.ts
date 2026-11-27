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

// A retrying run fills the log with identical rows and looks frozen. The notice
// sweeps a highlight through the text so it reads as active; the sweep is pure
// decoration, so it must switch off for users who ask for reduced motion.
test('the model retry notice sweeps its label and can be turned off', () => {
  const sweep = ruleBody('.retry-sweep')
  // Anchored at the line start: '-webkit-background-clip: text' also contains the
  // unprefixed substring, so a loose match would pass without the real rule.
  assert.ok(sweep.includes('\n  background-clip: text'), 'the highlight has to travel inside the glyphs, not across the row')
  assert.ok(sweep.includes('animation: retry-sheen'), 'without the animation the row looks static again')

  // The override lives in its own media block right after the rule set, so the
  // window starts at the rule and is long enough to reach the block.
  const raw = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const from = raw.indexOf('.retry-sweep')
  const window = raw.slice(from, from + 2400)
  assert.ok(window.includes('prefers-reduced-motion: reduce'), 'the sweep needs a reduced-motion override')
  assert.ok(window.includes('animation: none'), 'reduced motion must stop the sweep')
  assert.ok(window.includes('-webkit-text-fill-color: currentColor'), 'a transparent fill would leave reduced-motion users with no text at all')
})

// Opening the activity panel is a read-only action. It used to reserve 236px of
// right padding on the message column, so every bubble and the composer re-flowed
// to the left the moment the panel opened — the conversation appeared to jump.
// The panel is an overlay: absolute, above the messages, no width reservation.
test('the activity panel floats over the conversation without reflowing it', () => {
  assert.ok(
    !stylesheet.includes('has-activity-panel > .messages'),
    'reserving horizontal space for the panel moves the whole conversation when it opens'
  )
  const panel = ruleBody('.agent-activity-panel')
  assert.match(panel, /position:\s*absolute/, 'the panel must be taken out of flow, not placed beside the messages')
})

// An agent question belongs to the current run: it renders at the bottom of the
// conversation, in the composer area, and must not be a fixed overlay that hides
// the messages the question is about.
test('an inline agent question participates in the chat layout', () => {
  const inline = ruleBody('.workspace-interaction-inline')
  assert.match(inline, /width:\s*100%/, 'the inline question must fill the composer width')
  assert.doesNotMatch(inline, /position:\s*fixed/, 'a fixed card would behave like the modal it replaced')
  assert.doesNotMatch(inline, /position:\s*absolute/)
})

// The question card sits directly above the composer, so every extra line of
// option height is conversation the user cannot see. A four-option question used
// to be ~35px per option; each one is now a single row: the label never wraps,
// the description takes the leftover width and truncates (full text is in the
// button's `title`), and the list gap is tightened to match.
test('the inline question keeps every option on one line', () => {
  const option = ruleBody('.workspace-interaction-inline .interaction-option')
  assert.match(option, /display:\s*flex/, 'a grid option stacks the label over its description')
  assert.match(option, /align-items:\s*center/)
  const label = ruleBody('.workspace-interaction-inline .interaction-option-head strong')
  assert.match(label, /white-space:\s*nowrap/, 'a wrapping label silently grows the card')
  assert.match(label, /text-overflow:\s*ellipsis/)
  const description = ruleBody('.workspace-interaction-inline .interaction-option small')
  assert.match(description, /white-space:\s*nowrap/)
  assert.match(description, /text-overflow:\s*ellipsis/)
})

// A long answer quote or six options made the card taller than its ceiling, and
// the scroll used to live on the card itself — so "暂时跳过" sat below the fold.
// The scroll belongs to the middle section; the actions keep their own row.
test('the inline question scrolls its body, not its actions', () => {
  const card = ruleBody('.workspace-interaction-inline')
  assert.match(card, /overflow:\s*hidden/, 'a scrolling card takes the submit button with it')
  assert.doesNotMatch(card, /overflow-y:\s*auto/)
  const body = ruleBody('.workspace-interaction-inline > .interaction-body')
  assert.match(body, /overflow-y:\s*auto/, 'the middle section is what scrolls')
  assert.match(body, /flex:\s*1 1 auto/, 'without this the body cannot shrink below its content')
  const footer = ruleBody('.workspace-interaction-inline > footer')
  assert.match(footer, /flex:\s*0 0 auto/, 'the action row must keep its full height')
  assert.doesNotMatch(footer, /position:\s*sticky/, 'a sticky footer covers the options it floats over')
})

// A checklist is read top to bottom, one step per line. The lifecycle labels
// were short enough for a wrapped multi-column grid, but a model-written plan
// carries real titles; 125px columns turned those into stacked fragments that
// look like a different step each. The panel's own list is already one column.
test('the task checklist is one step per line, not a wrapped grid of columns', () => {
  const steps = ruleBody('.agent-plan-steps')
  assert.match(steps, /grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)/, 'auto-fit columns shred long step titles')
  assert.doesNotMatch(steps, /auto-fit|auto-fill/, 'a repeating track sizes to the widest title and wraps the rest')
  assert.match(ruleBody('.agent-plan-step > span:last-child'), /min-width:\s*0/, 'without this the title cannot shrink and pushes the row wide')
})
