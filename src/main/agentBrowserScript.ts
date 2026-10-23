/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
// Runs in an isolated renderer world. The model can supply values, never source code.
export function browserDomAction(input: { action: string; ref?: unknown; text?: unknown; direction?: unknown; token: string }) {
  const state = globalThis as typeof globalThis & { __gllmBrowser?: { url: string; refs: Map<string, { element: Element; signature: string }> } }
  const label = (element: HTMLElement) => (element.getAttribute('aria-label') || element.innerText || element.getAttribute('placeholder') || element.getAttribute('name') || '').slice(0, 160)
  const signature = (element: HTMLElement) => JSON.stringify([element.tagName, label(element), element.getAttribute('href'), element.getAttribute('type'), element.getAttribute('disabled')])
  const previous = state.__gllmBrowser
  if (['click', 'fill', 'focus'].includes(input.action)) {
    const entry = previous?.url === location.href ? previous.refs.get(String(input.ref)) : undefined
    const element = entry?.element
    if (!(element instanceof HTMLElement) || !element.isConnected || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') throw new Error('Stale or hidden control; request a new snapshot')
    if (signature(element) !== entry?.signature) throw new Error('Control changed since the snapshot; request a new snapshot before approval')
    // Invalidate *before* acting so errors or navigation cannot leave usable old refs.
    delete state.__gllmBrowser
    if (input.action === 'click') {
      if (element instanceof HTMLAnchorElement && !['http:', 'https:'].includes(new URL(element.href).protocol)) throw new Error('Link requires an HTTP(S) URL')
      if (element instanceof HTMLInputElement && element.type === 'file') throw new Error('User must choose files manually')
      element.click()
    } else if (input.action === 'fill') {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.disabled || element.readOnly || (element instanceof HTMLInputElement && ['password', 'file', 'hidden', 'checkbox', 'radio', 'submit', 'button'].includes(element.type))) throw new Error('This field requires manual input or is not editable')
      const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set
      setter!.call(element, String(input.text ?? ''))
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    } else element.focus()
    return null
  }
  if (input.action === 'scroll') window.scrollBy(0, (input.direction === 'up' ? -1 : 1) * Math.max(300, innerHeight * .8))
  const refs = new Map<string, { element: Element; signature: string }>()
  const controls: Array<{ ref: string; tag: string; label: string; href?: string; type?: string }> = []
  for (const element of document.querySelectorAll('a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[contenteditable=true]')) {
    if (!(element instanceof HTMLElement) || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue
    if (controls.length >= 120) break
    const ref = `${input.token}-${controls.length + 1}`
    refs.set(ref, { element, signature: signature(element) })
    controls.push({ ref, tag: element.tagName.toLowerCase(), label: label(element), ...(element instanceof HTMLAnchorElement ? { href: element.href } : {}), ...(element instanceof HTMLInputElement ? { type: element.type } : {}) })
  }
  state.__gllmBrowser = { url: location.href, refs }
  // Clone before reading text; omit scripts, password widgets and editable values.
  const body = document.body?.cloneNode(true) as HTMLElement | undefined
  body?.querySelectorAll('script,style,noscript,input,textarea,[contenteditable], [hidden]').forEach(element => element.remove())
  return { url: location.href, title: document.title, text: body?.innerText?.slice(0, 16000) || body?.textContent?.slice(0, 16000) || '', controls }
}

export function browserActionScript(input: Parameters<typeof browserDomAction>[0]): string {
  return `(() => { try { return { ok: true, value: (${browserDomAction.toString()})(${JSON.stringify(input)}) } } catch (error) { return { ok: false, error: String(error.message || error) } } })()`
}
