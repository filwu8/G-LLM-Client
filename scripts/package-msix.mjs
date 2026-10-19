/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
function option(name, fallback) {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}
if (process.platform !== 'win32') throw new Error('MSIX packaging requires Windows')
const identity = JSON.parse(await readFile(join(root, 'build/msix-identity.json'), 'utf8'))
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const appDirectory = resolve(option('--app-dir', join(root, 'dist/win-unpacked')))
const output = resolve(option('--output-dir', join(root, 'dist/msix')))
const sdk = option('--sdk-bin', process.env.MSIX_SDK_BIN)
if (!sdk || !existsSync(join(sdk, 'makeappx.exe'))) throw new Error('Set MSIX_SDK_BIN to a Windows SDK x64 bin directory containing makeappx.exe')
if (!existsSync(join(appDirectory, 'G-LLM-Client.exe'))) throw new Error('Build the Windows unpacked application first')
const acceptance = args.includes('--acceptance')
const unsigned = args.includes('--unsigned-test')
const version = `${metadata.version}.0`
if (!/^\d+\.\d+\.\d+\.0$/.test(version)) throw new Error('Store packages require a stable three-part app version')
const name = acceptance ? `${identity.name}.Acceptance` : identity.name
const publisher = acceptance ? `CN=GLLM Client Acceptance${unsigned ? ', OID.2.25.311729368913984317654407730594956997722=1' : ''}` : identity.publisher
const displayName = acceptance ? 'G-LLM Client Acceptance' : 'G-LLM Client'
const layout = join(output, `layout-${acceptance ? 'acceptance-' : ''}${Date.now()}`)
await mkdir(join(layout, 'Assets'), { recursive: true })
await cp(appDirectory, join(layout, 'app'), { recursive: true, errorOnExist: true })
const icon = await loadImage(join(root, 'resources/app-icon.png'))
for (const [file, width, height] of [
  ['StoreLogo.png', 50, 50], ['Square44x44Logo.png', 44, 44],
  ['Square150x150Logo.png', 150, 150], ['Wide310x150Logo.png', 310, 150]
]) {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  const size = Math.min(width, height)
  context.drawImage(icon, (width - size) / 2, (height - size) / 2, size, size)
  await writeFile(join(layout, 'Assets', file), canvas.toBuffer('image/png'))
}
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap rescap">
 <Identity Name="${xml(name)}" Publisher="${xml(publisher)}" Version="${version}" ProcessorArchitecture="x64" />
 <Properties><DisplayName>${xml(displayName)}</DisplayName><PublisherDisplayName>${xml(identity.publisherDisplayName)}</PublisherDisplayName><Description>Local AI desktop client</Description><Logo>Assets/StoreLogo.png</Logo></Properties>
 <Resources><Resource Language="en-US"/><Resource Language="zh-CN"/></Resources>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
 <Capabilities><Capability Name="internetClient"/><rescap:Capability Name="runFullTrust"/></Capabilities>
 <Applications><Application Id="${identity.applicationId}" Executable="app/G-LLM-Client.exe" EntryPoint="Windows.FullTrustApplication">
 <uap:VisualElements DisplayName="${xml(displayName)}" Description="Local AI desktop client" BackgroundColor="transparent" Square150x150Logo="Assets/Square150x150Logo.png" Square44x44Logo="Assets/Square44x44Logo.png"><uap:DefaultTile Wide310x150Logo="Assets/Wide310x150Logo.png"/></uap:VisualElements>
 <Extensions><uap:Extension Category="windows.protocol"><uap:Protocol Name="${acceptance ? 'gllm-acceptance' : 'gllm'}"><uap:DisplayName>${xml(displayName)}</uap:DisplayName></uap:Protocol></uap:Extension></Extensions>
 </Application></Applications>
</Package>
`
await writeFile(join(layout, 'AppxManifest.xml'), manifest, 'utf8')
const destination = join(output, `G-LLM-Client-${metadata.version}-x64${acceptance ? '-acceptance' : ''}.msix`)
execFileSync(join(sdk, 'makeappx.exe'), ['pack', '/d', layout, '/p', destination, '/o', '/h', 'SHA256'], { stdio: 'inherit' })
console.log(JSON.stringify({ package: destination, manifest: join(layout, 'AppxManifest.xml'), publisher, identity: name, version }, null, 2))
