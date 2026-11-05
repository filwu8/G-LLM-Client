/*
 * Copyright (c) 2026 GPROPHET LIMITED
 * SPDX-License-Identifier: BUSL-1.1
 * Change Date: 2030-08-01
 */
import { access, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname, basename } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolve('.')
const asarIndex = process.argv.indexOf('--app-asar')
const appRoot = asarIndex < 0 ? root : resolve(process.argv[asarIndex + 1])
const mainEntry = join(appRoot, 'out/main/index.js')
const fixture = await mkdtemp(join(tmpdir(), 'gllm-account-acceptance-'))
const profile = join(fixture, 'profile')
const appData = join(fixture, 'app-data')
const configPath = join(process.platform === 'win32' ? join(appData, 'G-LLM') : profile, 'g-llm-client.json')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
try {
  await access(asarIndex < 0 ? mainEntry : appRoot) // A normal build or packaged ASAR must precede this test.
  await mkdir(profile)
  await mkdir(appData)
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({
    settings: { language: 'en-US', theme: 'light', setupCompleted: true, telemetryEnabled: false, floatingMascotVisible: false },
    providers: [{ id: 'provider_fixture_other', templateId: 'openai-compatible', name: 'Fixture custom provider', apiBaseUrl: 'http://127.0.0.1:9/v1', apiKey: 'fixture-only-other-provider', defaultModel: 'fixture-custom-model', models: [{ id: 'fixture-custom-model' }], requiresApiKey: true }]
  }))
  const bootstrap = join(fixture, 'bootstrap.mjs')
  await writeFile(bootstrap, `
import { app, BrowserWindow, net, shell, safeStorage } from 'electron';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const root = ${JSON.stringify(root)}, fixture = ${JSON.stringify(fixture)}, phase = process.argv[2];
const config = ${JSON.stringify(configPath)};
const ledgerPath = join(fixture, 'server-ledger.json');
const token = code => 'sk-' + createHash('sha256').update('fixture-only-' + code).digest('hex').slice(0,48);
let exchangeCount = 0, accountCount = 0, accountMode = 'ready', catalogMode = 'ready', exchangeMode = 'ready', opened = [];
const response = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json'}});
app.setName('g-llm-client'); app.setAppPath(${JSON.stringify(appRoot)}); app.setVersion(JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version);
app.setPath('userData', join(fixture,'profile')); app.setPath('appData', join(fixture,'app-data'));
app.setAsDefaultProtocolClient = () => true; // Do not take over the user's installed gllm handler.
shell.openExternal = async url => { opened.push(url); };
net.fetch = async (url, init={}) => {
  if(url === 'https://llm.gprophet.com/api/client/handoff/exchange') {
    exchangeCount++; assert.equal(init.redirect,'error'); const {code}=JSON.parse(init.body);
    if(exchangeMode==='limited') return new Response(null,{status:429,headers:{'Retry-After':'45'}});
    if(exchangeMode==='offline') throw new Error('fixture-only exchange failure');
    const ledger=existsSync(ledgerPath)?JSON.parse(readFileSync(ledgerPath,'utf8')):{};
    if(ledger[code]) return response({success:false},410);
    ledger[code]=true; writeFileSync(ledgerPath,JSON.stringify(ledger));
    return response({success:true,data:{api_key:token(code)}});
  }
  if(url === 'https://llm.gprophet.com/api/client/account') {
    accountCount++;
    assert.equal(init.redirect,'error'); assert.equal(init.credentials,'omit');
    assert.ok(new Headers(init.headers).get('Authorization')?.startsWith('Bearer sk-'));
    if(accountMode==='revoked') return response({success:false},401);
    if(accountMode==='offline') throw new Error('fixture-only network failure');
    if(accountMode==='limited') return new Response(null,{status:429,headers:{'Retry-After':'45'}});
    return response({success:true,data:{remaining_quota:accountMode==='zero'?0:100,quota_per_unit:200}});
  }
  throw new Error('Unexpected external request blocked by fixture');
};
globalThis.fetch = async (url, init={}) => {
  if(String(url)==='https://llm.gprophet.com/v1/models') {
    assert.equal(init.redirect,'error'); if(catalogMode==='offline') throw new Error('fixture-only model failure');
    return response({data:[{id:'fixture-chat-model',type:'chat'}]});
  }
  throw new Error('Unexpected external request blocked by fixture');
};
await import(${JSON.stringify(pathToFileURL(mainEntry).href)});
const wait = async (check, message) => {const until=Date.now()+25000; while(Date.now()<until){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw new Error(message);};
const raw = () => JSON.parse(readFileSync(config,'utf8'));
const callback = code => 'gllm://providers/api-keys?v=1&source=g-llm&theme=gold&handoff='+code;
if(phase !== 'callback') {
  (async()=>{
    await app.whenReady(); let window;
    await wait(()=>{window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/renderer/index.html'));return window&&!window.webContents.isLoadingMainFrame();},'main window not ready');
    const invoke = (method) => window.webContents.executeJavaScript('window.gllm.'+method+'()');
    const state = () => invoke('getState');
    const connection = () => invoke('getGllmConnectionState');
    const capture = async name => {const dir=join(root,'.cache','account-ui');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name+'.png'),(await window.webContents.capturePage()).toPNG());};
    const refreshPanel = async text => {await window.webContents.executeJavaScript('Array.from(document.querySelectorAll(".gllm-account-actions button")).find(button=>button.textContent.includes("Refresh allowance"))?.click()');await wait(async()=> (await window.webContents.executeJavaScript('document.body.innerText')).includes(text),'quota UI state missing');};
    const secure = safeStorage.isEncryptionAvailable() && (process.platform!=='linux'||safeStorage.getSelectedStorageBackend()!=='basic_text');
    if(!secure) {
      assert.equal(process.platform,'linux','Windows/macOS require a usable OS credential store');
      if(phase==='interactive') {
        app.emit('second-instance', {}, ['fixture', callback('a'.repeat(64))], fixture);
        await wait(async()=> (await connection()).status==='error','plaintext fallback was not rejected');
        assert.equal((await connection()).reason,'storage');
        assert.ok(!readFileSync(config,'utf8').includes(token('a'.repeat(64))));
        console.log('Linux OS keyring unavailable: secure save refused; no plaintext fallback. Positive persistence checks require Windows/macOS.');
      }
      app.exit(0); return;
    }
    const secondary = async code => { await new Promise((done,fail)=>{const child=spawn(process.execPath,[${JSON.stringify(bootstrap)},'callback',callback(code)],{env:process.env,stdio:'ignore',windowsHide:true});child.once('error',fail);child.once('exit',c=>c===0?done():fail(new Error('callback process failed')));}); };
    if(phase==='interactive') {
      await wait(async()=> (await window.webContents.executeJavaScript('document.body.innerText')).includes('Register / sign in to get started'),'first-use sign-in entry missing');
      assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector(".provider-form"))'),false,'manual configuration must not open automatically for the official provider');
      await capture('onboarding-en');
      const initialSettings=(await state()).settings;
      await window.webContents.executeJavaScript('window.gllm.saveSettings('+JSON.stringify({...initialSettings,language:'zh-CN'})+')');
      await wait(async()=> (await window.webContents.executeJavaScript('document.body.innerText')).includes('注册 / 登录，开始使用'),'Chinese first-use entry missing');
      await capture('onboarding-zh');
      await window.webContents.executeJavaScript('window.gllm.saveSettings('+JSON.stringify(initialSettings)+')');
      const quick = new BrowserWindow({show:false,width:480,height:720,webPreferences:{preload:join(${JSON.stringify(appRoot)},'out/preload/index.mjs'),contextIsolation:true,sandbox:false}});
      await quick.loadFile(join(${JSON.stringify(appRoot)},'out/renderer/index.html'),{hash:'quick'});
      await wait(async()=> (await quick.webContents.executeJavaScript('document.body.innerText')).includes('Register / sign in to get started'),'Quick Chat sign-in entry missing');
      const previewDir=join(root,'.cache','account-ui');mkdirSync(previewDir,{recursive:true});writeFileSync(join(previewDir,'quick-onboarding-en.png'),(await quick.webContents.capturePage()).toPNG());
      quick.destroy();
      await invoke('connectGllm'); assert.equal(opened[0],'https://llm.gprophet.com/client/connect');
      await wait(async()=> (await connection()).status==='waiting','waiting state missing');
      await wait(async()=> (await window.webContents.executeJavaScript('document.body.innerText')).includes('Browser opened.'),'waiting hint missing');
      await capture('waiting-en');
      await invoke('cancelGllmConnection'); await secondary('a'.repeat(64));
      await new Promise(r=>setTimeout(r,150)); assert.equal(exchangeCount,0); assert.equal((await connection()).status,'cancelled');
      await invoke('retryGllmConnection'); catalogMode='offline'; window.minimize(); await secondary('a'.repeat(64));
      await wait(async()=> (await connection()).reason==='models','model failure must retain a saved credential');
      await wait(()=>window.isVisible()&&!window.isMinimized(),'callback did not restore the existing main window');
      const encrypted=raw().providers.find(p=>p.id==='provider_gllm').apiKey;
      assert.ok(encrypted.startsWith('gllm-os-encrypted:v1:'));
      assert.ok(!readFileSync(config,'utf8').includes(token('a'.repeat(64))),'plaintext credential leaked to configuration');
      catalogMode='ready'; await invoke('retryGllmConnection');
      await wait(async()=> (await connection()).status==='success','model retry did not complete');
      assert.equal(exchangeCount,1,'model retry must not redeem a consumed code again');
      await secondary('a'.repeat(64)); await new Promise(r=>setTimeout(r,150)); assert.equal(exchangeCount,1);
      const saved=await state(), provider=saved.providers.find(p=>p.id==='provider_gllm');
      assert.ok(saved.providers.find(p=>p.id==='provider_fixture_other')?.apiKey==='fixture-only-other-provider','manual provider credential changed');
      assert.ok(!readFileSync(config,'utf8').includes('fixture-only-other-provider'),'manual provider plaintext was written back during official login');
      assert.equal(saved.settings.activeProviderId,'provider_gllm'); assert.equal(saved.settings.theme,'light','auth callback must not force the paid gold theme');
      assert.equal(provider.defaultModel,'fixture-chat-model'); assert.equal(provider.apiBaseUrl,'https://llm.gprophet.com/v1');
      const normal=await invoke('getGllmAccount'); assert.equal(normal.status,'ready'); assert.equal(normal.remainingQuota/normal.quotaPerUnit,0.5);
      accountMode='zero'; assert.equal((await invoke('getGllmAccount')).remainingQuota,0);
      await refreshPanel('Your account allowance is exhausted'); await capture('zero-allowance-en');
      accountMode='revoked'; assert.equal((await invoke('getGllmAccount')).status,'unauthorized');
      accountMode='offline'; assert.equal((await invoke('getGllmAccount')).status,'unavailable');
      await refreshPanel('Allowance is temporarily unavailable');
      assert.ok((await state()).providers.find(p=>p.id==='provider_gllm').apiKey===token('a'.repeat(64)),'account errors must not erase the credential');
      accountMode='ready'; assert.equal((await invoke('getGllmAccount')).status,'ready');
      exchangeMode='offline'; await invoke('connectGllm'); await secondary('z'.repeat(64));
      await wait(async()=> (await connection()).status==='error','exchange network error was not reported');
      assert.equal((await connection()).reason,'exchange');
      assert.ok((await state()).providers.find(p=>p.id==='provider_gllm').apiKey===token('a'.repeat(64)),'exchange network failure changed an existing account');
      await invoke('cancelGllmConnection');
      exchangeMode='limited'; await invoke('connectGllm'); await secondary('x'.repeat(64));
      await wait(async()=> (await connection()).reason==='rateLimit','exchange rate limit was not reported');
      const previousExchanges=exchangeCount, previousOpens=opened.length;
      await invoke('retryGllmConnection'); await secondary('y'.repeat(64));
      assert.equal(exchangeCount,previousExchanges); assert.equal(opened.length,previousOpens);
      accountMode='limited'; assert.equal((await invoke('getGllmAccount')).status,'rate-limited');
      const previousAccounts=accountCount;
      await refreshPanel('The service is limiting allowance requests');
      assert.equal((await invoke('getGllmAccount')).status,'rate-limited');
      assert.equal(accountCount,previousAccounts,'refresh bypassed the account cooldown');
      console.log('Built app passed: first-use UI, fixed browser URL, cancel/late callback, actual second-instance callback, secure persistence, model retry, duplicate callback, personal quota, zero/revoked/network states.');
    } else if(phase==='restart') {
      assert.ok((await state()).providers.find(p=>p.id==='provider_gllm').apiKey===token('a'.repeat(64)),'OS credential did not survive process restart');
      assert.equal(exchangeCount,0); console.log('Built app restart passed: credential decrypted through the real OS backend, no reauthorization or allowance issuance.');
    } else if(phase==='cold') {
      await wait(async()=> (await connection()).status==='success','cold-start callback not completed');
      assert.ok((await state()).providers.find(p=>p.id==='provider_gllm').apiKey===token('b'.repeat(64)));
      assert.equal(exchangeCount,1); console.log('Built app cold-start callback passed: actual startup arguments, window ready and available default model.');
    } else if(phase==='reused') {
      await wait(async()=> (await connection()).status==='error','reused code must fail across restarts');
      assert.ok((await state()).providers.find(p=>p.id==='provider_gllm').apiKey===token('b'.repeat(64)),'reused code must preserve existing credentials');
      console.log('Built app replay passed: server refuses reused code across restarts, existing credential retained.');
    } else if(phase==='legacy') {
      const current=await state(); assert.ok(current.providers.find(p=>p.id==='provider_gllm').apiKey===token('c'.repeat(64)));
      assert.ok(!readFileSync(config,'utf8').includes(token('c'.repeat(64))),'legacy plaintext remained in the current configuration');
      assert.equal(raw().settings.apiKey,undefined); console.log('Legacy migration passed: provider and old settings credentials encrypted without retaining the plaintext setting.');
    } else if(phase==='locked') {
      const current=await state(), provider=current.providers.find(p=>p.id==='provider_gllm');
      assert.equal(provider.apiKey,''); assert.equal(provider.credentialUnavailable,true);
      const ciphertext=raw().providers.find(p=>p.id==='provider_gllm').apiKey;
      await window.webContents.executeJavaScript('window.gllm.saveProvider('+JSON.stringify({...provider,name:'Metadata-only edit'})+')');
      assert.equal(raw().providers.find(p=>p.id==='provider_gllm').apiKey,ciphertext,'locked ciphertext was erased by a metadata save');
      console.log('Locked credential passed: unavailable state is explicit, original ciphertext retained through metadata changes.');
    }
    const scanLogs = directory => {for(const item of readdirSync(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory() && !['Cache','Code Cache','GPUCache'].includes(item.name))scanLogs(path);else if(item.isFile()&&item.name.endsWith('.log')){const text=readFileSync(path,'utf8');assert.ok(!text.includes(token('a'.repeat(64)))&&!text.includes(token('b'.repeat(64))),'credential in logs');assert.ok(!text.includes('handoff='+'a'.repeat(64)),'authorization code in logs');}}};
    scanLogs(fixture);
    app.exit(0);
  })().catch(error=>{console.error('Built account acceptance failed in phase: '+phase+' (credential values suppressed)'); console.error(String(error.stack).split('\\n').filter(line=>line.trim().startsWith('at ')).slice(0,4).join('\\n'));app.exit(1);});
}
`)
  for (const phase of ['interactive', 'restart', 'cold', 'reused', 'legacy', 'locked']) {
    if (phase === 'legacy') {
      const { createHash } = await import('node:crypto')
      const config = JSON.parse(await readFile(configPath, 'utf8'))
      config.providers = []
      config.settings.apiKey = 'sk-' + createHash('sha256').update('fixture-only-' + 'c'.repeat(64)).digest('hex').slice(0, 48)
      await writeFile(configPath, JSON.stringify(config))
    }
    if (phase === 'locked') {
      const config = JSON.parse(await readFile(configPath, 'utf8'))
      // Not a real credential: intentionally corrupt an envelope to emulate a
      // moved or inaccessible OS key without changing system security settings.
      config.providers = config.providers.map(provider => ({ ...provider, apiKey: 'gllm-os-encrypted:v1:' + Buffer.from('fixture-invalid-ciphertext').toString('base64') }))
      await writeFile(configPath, JSON.stringify(config))
    }
    const args = [bootstrap, phase]
    if (phase === 'cold' || phase === 'reused') args.push(`gllm://providers/api-keys?v=1&source=g-llm&theme=gold&handoff=${'b'.repeat(64)}`)
    const code = await new Promise((fulfil, reject) => {
      const child = spawn(require('electron'), args, { env, stdio: 'inherit', windowsHide: true })
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`Account acceptance timed out: ${phase}`)) }, 60_000)
      child.once('error', error => { clearTimeout(timeout); reject(error) })
      child.once('exit', code => { clearTimeout(timeout); fulfil(code ?? 1) })
    })
    if (code !== 0) throw new Error(`Account acceptance failed: ${phase}`)
  }
  console.log('Account integration used only an isolated profile, generated fixture credentials and in-process mock responses. No user account or paid model service was used.')
} finally {
  if (dirname(fixture) !== resolve(tmpdir()) || !basename(fixture).startsWith('gllm-account-acceptance-')) throw new Error('Refusing cleanup outside the created fixture')
  await rm(fixture, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 })
}
