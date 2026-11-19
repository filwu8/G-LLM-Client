/**
 * One-shot overlay pipeline warm-up.
 *
 * The first overlay (any `assistant-modal-backdrop` surface) pays a one-time cost:
 * text shaping for the dialog's type ramp, a full-document layout, and building the
 * compositing/raster pipeline for a full-screen `backdrop-filter` layer. Measured on
 * a cold start that is ~100ms with 2 long frames, while every later overlay is ~40ms
 * with none. Users read that first hit as "the buttons are slow".
 *
 * So we render a throwaway skeleton with the real CSS classes and the real translated
 * copy during idle time after first paint, let it rasterise for two frames, then drop
 * it. Nothing is left in the DOM, no IPC runs, no component state is touched.
 */
let primedLanguage = ''

function node(tag: string, className?: string, text?: string): HTMLElement {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function buildSkeleton(t: (key: string) => string): HTMLElement {
  const host = node('div')
  host.id = 'gllm-overlay-prewarm'
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:0.004;contain:strict'

  const backdrop = node('div', 'assistant-modal-backdrop workspace-approval-backdrop')
  const dialog = node('section', 'workspace-approval-dialog workspace-agent-settings')

  const header = node('header')
  const headerCopy = node('div')
  headerCopy.append(
    node('strong', undefined, t('workspace.agentSettings')),
    node('small', undefined, 'C:\\Users\\prewarm')
  )
  header.append(headerCopy)
  dialog.append(header)

  const summary = node('p')
  summary.append(node('strong', undefined, t('workspace.desktopAccess')))
  summary.append(document.createTextNode(' · Windows'))
  dialog.append(summary)

  // Label + description pairs mirroring the real dialog, so text shaping and the
  // paragraph metrics are already cached before the user opens it.
  const pairs: Array<[string, string | null]> = [
    ['workspace.browserWindowAccess', 'workspace.browserWindowAccessDescription'],
    ['workspace.computerWindowAccess', 'workspace.computerWindowAccessDescription'],
    ['workspace.computerAccess', 'workspace.computerAccessDescription'],
    ['workspace.browserAccess', 'workspace.browserAccessDescription'],
    ['workspace.agentLoadRules', 'workspace.agentRulesDescription'],
    ['workspace.agentNative', 'workspace.agentApprovalHint'],
    ['workspace.agentNetworkOn', 'workspace.agentNetworkDescription'],
    ['workspace.harnessEnable', 'workspace.harnessDescription'],
    ['workspace.harnessDelegateAll', 'workspace.harnessDelegateAllDescription']
  ]
  for (const [labelKey, descriptionKey] of pairs) {
    const label = node('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    label.append(input, document.createTextNode(t(labelKey)))
    dialog.append(label)
    if (descriptionKey) dialog.append(node('p', undefined, t(descriptionKey)))
  }

  // The execution-mode row renders text inside a <select>, which uses its own font.
  const modeLabel = node('label', undefined, t('workspace.agentExecutionMode'))
  const select = document.createElement('select')
  for (const optionKey of ['workspace.agentSandbox', 'workspace.agentHost']) {
    const option = document.createElement('option')
    option.textContent = t(optionKey)
    select.append(option)
  }
  modeLabel.append(select)
  dialog.append(modeLabel)

  for (const paragraphKey of [
    'workspace.windowDataNotice',
    'workspace.agentSandboxBoundary',
    'workspace.checkTitle',
    'workspace.checkScope',
    'workspace.agentVariables',
    'workspace.agentVariablesDescription'
  ]) {
    dialog.append(node('p', undefined, t(paragraphKey)))
  }

  // Exercise the footer button metrics too, so their font is shaped as well.
  const footer = node('footer')
  footer.append(
    node('button', 'secondary-action', t('common.cancel')),
    node('button', 'primary-action', t('common.save'))
  )
  dialog.append(footer)

  backdrop.append(dialog)
  host.append(backdrop)
  return host
}

export function primeOverlayPipeline(t: (key: string) => string, language: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  if (primedLanguage === language) return
  primedLanguage = language

  const run = () => {
    if (document.getElementById('gllm-overlay-prewarm')) return
    let host: HTMLElement
    try {
      host = buildSkeleton(t)
      document.body.appendChild(host)
    } catch {
      return
    }
    const dispose = () => host.remove()
    // Two frames guarantees the compositor actually rasterises the layer,
    // which is the part that is expensive the first time.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(dispose, 80)
      })
    })
    // Safety net: never leave the skeleton behind if frames are throttled.
    window.setTimeout(dispose, 4000)
  }

  const idle = window.requestIdleCallback
  if (typeof idle === 'function') idle(run, { timeout: 2500 })
  else window.setTimeout(run, 1200)
}
