/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1 — Change Date: 2030-08-01 */
import { app, BrowserWindow, nativeImage } from 'electron'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { WindowControlSession } from './windowControl'

const profile = process.argv[2]
app.setPath('userData', profile)
;(app as typeof app & { setAppPath(path: string): void }).setAppPath(process.cwd())
app.on('window-all-closed', () => {})

const system = join(process.env.SystemRoot || 'C:\\Windows', 'System32')
const children: ChildProcess[] = []
const marker = `GLLM-window-test-${randomUUID().slice(0, 8)}`

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><title>${marker}${request.url === '/next' ? '-next' : ''}</title>
    <main><input id="query" aria-label="Fixture query"><input type="password" aria-label="Fixture password">
    <button style="background:#f0f;min-width:140px;min-height:40px" onclick="document.title='${marker}-applied';document.querySelector('output').textContent='Applied '+document.querySelector('#query').value">Fixture apply</button>
    <p><output>Fixture ready</output></p></main>`)
})

interface WindowEntry { ref: string; app: string; title: string }
interface Snapshot { observation: string; title: string; controls: Array<{ ref: string; name: string; password?: boolean; editable?: boolean }>; text: string[] }
const data = <T>(output: string): T => JSON.parse(output.slice(output.indexOf('\n') + 1))
const run = (session: WindowControlSession, args: Record<string, unknown>) => session.prepare({ purpose: 'Verify G-LLM window control', ...args }).execute()
const list = async (session: WindowControlSession) => data<WindowEntry[]>((await run(session, { action: 'list_windows' })).output)

async function waitForWindow(session: WindowControlSession, predicate: (entry: WindowEntry) => boolean) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const entry = (await list(session)).find(predicate)
    if (entry) return entry.ref
    await delay(200)
  }
  throw new Error('The fixture window did not open')
}

async function snapshot(session: WindowControlSession, window: string) {
  return data<Snapshot>((await run(session, { action: 'snapshot', window })).output)
}

function control(page: Snapshot, name: string) {
  const entry = page.controls.find(item => item.name === name)
  assert.ok(entry, `Missing ${name}. Snapshot: ${JSON.stringify(page)}`)
  return entry
}

function fixtureProcess(executable: string, args: string[], hideConsole = false) {
  const process = spawn(executable, args, { windowsHide: hideConsole, stdio: ['ignore', 'ignore', hideConsole ? 'inherit' : 'ignore'] })
  children.push(process)
  return new Promise<void>((resolve, reject) => { process.once('spawn', resolve); process.once('error', reject) })
}

async function approveFixture(owner: BrowserWindow, label: string) {
  const page = `<title>G-LLM window-control test</title><button autofocus onclick="document.body.dataset.approved='yes'">Approve ${label} test</button>`
  await owner.loadURL(`data:text/html,${encodeURIComponent(page)}`)
  owner.show()
  owner.focus()
  owner.setAlwaysOnTop(true)
  console.log(`Click Approve ${label} test in the test window to simulate approval from a foreground application.`)
  for (let attempt = 0; attempt < 600; attempt++) {
    if (await owner.webContents.executeJavaScript("document.body.dataset.approved === 'yes'")) {
      owner.setAlwaysOnTop(false)
      return
    }
    await delay(250)
  }
  throw new Error('The fixture approval window did not receive a click')
}

async function clickFixtureInScreenshot(session: WindowControlSession, window: string) {
  const screenshot = await run(session, { action: 'screenshot', window })
  assert.ok(screenshot.imageDataUrl)
  const image = nativeImage.createFromDataURL(screenshot.imageDataUrl)
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  let count = 0, totalX = 0, totalY = 0
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4
      if (bitmap[offset] > 200 && bitmap[offset + 1] < 50 && bitmap[offset + 2] > 200) {
        totalX += x; totalY += y; count++
      }
    }
  }
  assert.ok(count > 200, 'The native screenshot contains the fixture button')
  const { observation, imageSize } = data<{ observation: string; imageSize: { width: number; height: number } }>(screenshot.output)
  assert.deepEqual(imageSize, { width, height })
  await run(session, { action: 'click', window, observation, x: Math.round(totalX / count), y: Math.round(totalY / count) })
}

async function desktopFixture(owner: BrowserWindow) {
  const desktop = new WindowControlSession('computer_window', true)
  const browser = new WindowControlSession('browser_window', false)
  await fixtureProcess(join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-STA', '-EncodedCommand', Buffer.from(`
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Windows.Forms,System.Drawing
    Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
    using System.Drawing;
    using System.Windows.Forms;
    public static class GllmFixture {
      public static void Open(string title) {
        var form = new Form { Text = title, ClientSize = new Size(380, 180), StartPosition = FormStartPosition.CenterScreen };
        var query = new TextBox { AccessibleName = "Fixture query" };
        query.SetBounds(30, 20, 240, 25);
        var status = new Label { Text = "Fixture ready" };
        status.SetBounds(30, 55, 280, 30);
        var button = new Button { Text = "Fixture apply", BackColor = Color.Fuchsia };
        button.SetBounds(30, 100, 140, 40);
        button.Click += delegate { status.Text = "Applied " + query.Text; };
        form.Controls.AddRange(new Control[] { query, status, button });
        form.Show();
        form.Hide();
        Application.Run(form);
      }
    }
'@
    [GllmFixture]::Open('${marker}-desktop')
  `, 'utf16le').toString('base64')], true)
  const window = await waitForWindow(desktop, entry => entry.title === `${marker}-desktop`)
  assert.equal((await list(browser)).some(entry => entry.title === `${marker}-desktop`), false, 'Browser grant never exposes a native application')
  assert.throws(() => browser.prepare({ purpose: 'Scope check', action: 'snapshot', window }), /window ref/)

  let page = await snapshot(desktop, window)
  const query = control(page, 'Fixture query')
  assert.equal(query.editable, true)
  await approveFixture(owner, 'desktop')
  await run(desktop, { action: 'fill', window, observation: page.observation, ref: query.ref, text: '桌面输入' })
  assert.throws(() => desktop.prepare({ purpose: 'Stale check', action: 'click', window, observation: page.observation, ref: query.ref }), /fresh snapshot/)
  page = await snapshot(desktop, window)
  await run(desktop, { action: 'click', window, observation: page.observation, ref: query.ref })
  page = await snapshot(desktop, window)
  await run(desktop, { action: 'type', window, observation: page.observation, text: '✓' })

  await clickFixtureInScreenshot(desktop, window)
  page = await snapshot(desktop, window)
  assert.match(page.text.join(' '), /Applied 桌面输入✓/)
  console.log('Windows application passed: native controls, Unicode input, window screenshot and pixel click.')
}

async function browserFixture(owner: BrowserWindow, browser: { name: string; path: string }, url: string) {
  const session = new WindowControlSession('browser_window', true)
  await fixtureProcess(browser.path, [`--user-data-dir=${join(profile, browser.name)}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--new-window', '--window-size=900,700', url])
  const window = await waitForWindow(session, entry => entry.app.toLowerCase() === browser.name && entry.title.startsWith(marker))
  await approveFixture(owner, browser.name)
  await run(session, { action: 'focus', window })
  let page = await snapshot(session, window)
  const query = page.controls.find(item => item.name === 'Fixture query' && item.editable)
  assert.throws(() => session.prepare({ purpose: 'URL guard', action: 'navigate', window, observation: page.observation, url: 'file:///C:/Windows/' }), /HTTP\(S\)/)
  if (query) {
    assert.match(page.text.join(' '), /Fixture ready/)
    const password = control(page, 'Password (manual input)')
    assert.throws(() => session.prepare({ purpose: 'Password guard', action: 'fill', window, observation: page.observation, ref: password.ref, text: 'dummy' }), /manual input/)
    await run(session, { action: 'fill', window, observation: page.observation, ref: query.ref, text: '浏览器输入' })
    page = await snapshot(session, window)
    await run(session, { action: 'click', window, observation: page.observation, ref: control(page, 'Fixture apply').ref })
  } else await clickFixtureInScreenshot(session, window)
  const applied = await waitForWindow(session, entry => entry.app.toLowerCase() === browser.name && entry.title.startsWith(`${marker}-applied`))
  page = await snapshot(session, applied)
  if (query) assert.match(page.text.join(' '), /Applied 浏览器输入/)
  await run(session, { action: 'navigate', window: applied, observation: page.observation, url: `${url}next` })
  const next = await waitForWindow(session, entry => entry.app.toLowerCase() === browser.name && entry.title.startsWith(`${marker}-next`))
  page = await snapshot(session, next)
  await run(session, { action: 'back', window: next, observation: page.observation })
  const original = await waitForWindow(session, entry => entry.app.toLowerCase() === browser.name && entry.title.startsWith(marker) && !entry.title.startsWith(`${marker}-next`))
  assert.match((await snapshot(session, original)).title, new RegExp(marker))
  console.log(`${browser.name} passed: used an existing window, ${query ? 'filled and clicked via accessibility' : 'clicked via the screenshot'}, navigated and went back.`)
}

async function main() {
  await app.whenReady()
  const owner = new BrowserWindow({ title: 'G-LLM window-control test', width: 320, height: 180 })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  const fixture = process.env.GLLM_WINDOW_TEST_APP
  if (!fixture || fixture === 'desktop') await desktopFixture(owner)
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter((path): path is string => Boolean(path))
  const browsers = [
    { name: 'chrome', relative: 'Google/Chrome/Application/chrome.exe' },
    { name: 'msedge', relative: 'Microsoft/Edge/Application/msedge.exe' }
  ]
  for (const browser of browsers) {
    if (fixture && fixture !== browser.name) continue
    const path = roots.map(root => join(root, browser.relative)).find(existsSync)
    if (path) await browserFixture(owner, { ...browser, path }, url)
    else console.log(`${browser.name} skipped: not installed.`)
  }
}

function finish(code: number) {
  for (const child of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode) continue
    try { execFileSync(join(system, 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) }
    catch { child.kill() }
  }
  server.close()
  app.exit(code)
}

main().then(() => finish(0)).catch(error => { console.error(error); finish(1) })
