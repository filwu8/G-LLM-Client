/* Copyright (c) 2026 GPROPHET LIMITED — SPDX-License-Identifier: BUSL-1.1  — Change Date: 2030-08-01 */
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const temporary = await mkdtemp(join(tmpdir(), 'gllm-browser-test-'))
try {
  await writeFile(join(temporary, 'package.json'), '{"type":"commonjs"}')
  for (const name of ['appIcon', 'agentBrowser', 'agentBrowserScript', 'desktopToolPolicy', 'agentBrowser.integration']) {
    const source = await readFile(resolve('src/main', `${name}.ts`), 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
    await writeFile(join(temporary, `${name}.js`), compiled.outputText)
  }
  if (process.argv.includes('--built')) {
    // Extract the compiled browser functions without executing the app startup
    // code that Rollup may place in the same chunk. Function bodies stay intact.
    const names = new Set(['getAppIconPath', 'browserUrl', 'browserDomAction', 'browserActionScript', 'browserApprovalPreview', 'closeAgentBrowser', 'getBrowser', 'runBrowserAction', 'browsers', 'snapshots', 'initializedSessions', 'world', 'browserStateListener', 'setAgentBrowserStateListener', 'isAgentBrowserOpen', 'showAgentBrowser'])
    const appBindings = new Set(['app'])
    const joinBindings = new Set(['join'])
    const compiled = []
    for (const file of (await readdir(resolve('out/main'))).filter(name => name.endsWith('.js'))) {
      const source = ts.createSourceFile(file, await readFile(resolve('out/main', file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      for (const statement of source.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          const bindings = statement.importClause?.namedBindings
          if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
            const imported = binding.propertyName?.text ?? binding.name.text
            if (statement.moduleSpecifier.text === 'electron' && imported === 'app') appBindings.add(binding.name.text)
            if (statement.moduleSpecifier.text === 'node:path' && imported === 'join') joinBindings.add(binding.name.text)
          }
        }
        const name = ts.isFunctionDeclaration(statement) ? statement.name?.text : ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1 ? statement.declarationList.declarations[0].name.getText(source) : undefined
        if (name && names.delete(name)) compiled.push(statement.getText(source))
      }
    }
    if (names.size) throw new Error(`Missing production browser code: ${[...names].join(', ')}`)
    const builtFile = join(temporary, 'browser-built.mjs')
    const appImports = [...appBindings].map(name => name === 'app' ? 'app' : `app as ${name}`).join(', ')
    const joinImports = [...joinBindings].map(name => name === 'join' ? 'join' : `join as ${name}`).join(', ')
    await writeFile(builtFile, `import { BrowserWindow, session, ${appImports} } from 'electron'; import { ${joinImports} } from 'node:path'; import { createHash, randomUUID } from 'node:crypto';\n${compiled.join('\n')}\nexport { runBrowserAction, closeAgentBrowser, isAgentBrowserOpen, showAgentBrowser, setAgentBrowserStateListener };`)
    const url = pathToFileURL(builtFile).href
    await writeFile(join(temporary, 'agentBrowser.js'), `const loaded = import(${JSON.stringify(url)}); for (const name of ['runBrowserAction', 'closeAgentBrowser', 'isAgentBrowserOpen', 'showAgentBrowser', 'setAgentBrowserStateListener']) exports[name] = async (...args) => (await loaded)[name](...args);`)
  }
  const profile = join(temporary, 'profile')
  await mkdir(profile)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const exitCode = await new Promise((resolvePromise, reject) => {
    const child = spawn(require('electron'), [join(temporary, 'agentBrowser.integration.js'), profile], { env, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', code => resolvePromise(code ?? 1))
  })
  process.exitCode = exitCode
} finally {
  await rm(temporary, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 })
}
