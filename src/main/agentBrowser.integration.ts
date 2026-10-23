/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { app, BrowserWindow, nativeImage } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { closeAgentBrowser, isAgentBrowserOpen, runBrowserAction, setAgentBrowserStateListener, showAgentBrowser } from './agentBrowser'
import { getAppIconPath } from './appIcon'

app.setPath('userData', process.argv[2])
app.on('window-all-closed', () => {})
const conversation = 'browser-integration'
const html = `<!doctype html><title>Browser fixture</title><input aria-label="Query"><input type="password" aria-label="Password"><input type="file" aria-label="File"><button onclick="document.querySelector('output').textContent='Clicked'">Apply</button><output>Ready</output><a href="javascript:document.title='unsafe'">Unsafe</a><script>document.querySelector('input').oninput=e=>document.querySelector('output').textContent=e.target.value</script>`
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html) })
type Snapshot = { url: string; title: string; text: string; controls: Array<{ ref: string; label: string; type?: string }> }
const action = (args: Record<string, unknown>) => runBrowserAction(conversation, { purpose: 'Browser integration check', ...args })
const snapshot = (output: string) => JSON.parse(output.slice(output.indexOf('\n') + 1)) as Snapshot
const ref = (page: Snapshot, label: string) => { const found = page.controls.find(control => control.label === label); assert.ok(found, `Missing ${label}`); return found.ref }

async function main() {
  await app.whenReady()
  const changes: Array<[string, boolean]> = []
  await setAgentBrowserStateListener((id, open) => changes.push([id, open]))
  assert.equal(await showAgentBrowser('missing-conversation'), false)
  assert.equal(await isAgentBrowserOpen(conversation), false)
  assert.equal(nativeImage.createFromPath(getAppIconPath()).isEmpty(), false, 'The shared application logo must load in the browser window')
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}/`
  await assert.rejects(action({ action: 'navigate', url: 'file:///etc/passwd' }))
  let page = snapshot((await action({ action: 'navigate', url })).output)
  assert.equal(page.title, 'Browser fixture')
  const oldRef = ref(page, 'Apply')
  page = snapshot((await action({ action: 'fill', ref: ref(page, 'Query'), text: '电脑与浏览器 — typed' })).output)
  assert.match(page.text, /电脑与浏览器 — typed/)
  await assert.rejects(action({ action: 'click', ref: oldRef }), /Stale/)
  page = snapshot((await action({ action: 'snapshot' })).output)
  page = snapshot((await action({ action: 'click', ref: ref(page, 'Apply') })).output)
  assert.match(page.text, /Clicked/)
  await assert.rejects(action({ action: 'fill', ref: ref(page, 'Password'), text: 'not-a-real-secret' }), /manual/)
  page = snapshot((await action({ action: 'snapshot' })).output)
  await assert.rejects(action({ action: 'click', ref: ref(page, 'File') }), /manually/)
  page = snapshot((await action({ action: 'snapshot' })).output)
  const browser = BrowserWindow.getAllWindows()[0]
  assert.ok(browser)
  await browser.webContents.executeJavaScript("document.querySelector('button').textContent='Changed after approval preview'")
  await assert.rejects(action({ action: 'click', ref: ref(page, 'Apply') }), /changed since/)
  page = snapshot((await action({ action: 'snapshot' })).output)
  await assert.rejects(action({ action: 'click', ref: ref(page, 'Unsafe') }), /HTTP\(S\)/)
  assert.equal(await browser.webContents.executeJavaScript('typeof require'), 'undefined')
  assert.equal(await browser.webContents.executeJavaScript('typeof process'), 'undefined')
  const windows = BrowserWindow.getAllWindows().length
  await browser.webContents.executeJavaScript(`window.open(${JSON.stringify(url)})`)
  assert.equal(BrowserWindow.getAllWindows().length, windows)
  const next = snapshot((await action({ action: 'navigate', url: `${url}second-page` })).output)
  assert.equal(next.url, `${url}second-page`)
  assert.equal(BrowserWindow.getAllWindows().length, windows, 'navigation reuses the single page instead of creating tabs or windows')
  assert.equal(BrowserWindow.getAllWindows()[0], browser)
  assert.equal(await isAgentBrowserOpen(conversation), true)
  browser.hide()
  assert.equal(await showAgentBrowser(conversation), true)
  assert.equal(browser.isVisible(), true, 'Viewing the browser restores an existing hidden window')
  assert.equal(BrowserWindow.getAllWindows().length, windows)
  assert.equal(await showAgentBrowser('another-conversation'), false, 'Viewing never creates a browser or borrows another conversation')
  await action({ action: 'close' })
  assert.equal(await isAgentBrowserOpen(conversation), false)
  assert.equal(await showAgentBrowser(conversation), false)
  assert.deepEqual(changes, [[conversation, true], [conversation, false]])
  await action({ action: 'navigate', url })
  const reopened = BrowserWindow.getAllWindows()[0]
  await new Promise<void>(resolve => { reopened.once('closed', () => resolve()); reopened.close() })
  assert.equal(await isAgentBrowserOpen(conversation), false)
  assert.deepEqual(changes.slice(-2), [[conversation, true], [conversation, false]], 'Manual window close updates both conversation UIs')
  assert.equal(BrowserWindow.getAllWindows().length, 0)
  console.log('Browser integration passed: navigation, snapshots, Unicode fill, clicks, stale refs, manual credentials, isolation and popup blocking.')
}
main().then(() => { server.close(); app.exit(0) }).catch(error => { console.error(error); closeAgentBrowser(conversation); server.close(); app.exit(1) })
