// A tap-only probe of Gboard's first-word capitalisation in an empty editor, for the PTE playground
// question: the deployed playground does not capitalise the first word, the demo PTE page does. It does
// not use `runOnDevice`, which needs thumbjar's recorder in the page, so every case, the demo pages and
// https://playground.portabletext.org/ alike, is driven the same way: `adb shell input tap` for the tap
// into the field and every key, the system `uiautomator dump` for Gboard's keys and its Shift state, and
// a `beforeinput` logger injected over the Chrome DevTools protocol.
//
// Per run it writes `out/probe/<case>-<run>/`:
// - `page-before-tap.json`: focus, selection and the first block's HTML after load, before the tap
// - `page-before-keys.json`: the same after the tap, before the first key, with the text before the caret
// - `keyboard-before.xml`: the screen dump before the first letter, whose Shift key says the Shift state
// - `ime.txt`: `dumpsys input_method` and Gboard's own service dump, with the field's `EditorInfo`
//   (`inputType`, `initialCapsMode`, `initialSelStart`)
// - `keyboard-after-h.xml`: the dump after the first letter
// - `log.json`: every `beforeinput` and `input` with target ranges and their containers' text, and the
//   first block's text after the last key
// - `before-keys.png` and `final.png`
// and appends one line per run to `out/probe-results.jsonl`.

import {execFile} from 'node:child_process'
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {promisify} from 'node:util'
import {test} from 'vitest'

const execFileAsync = promisify(execFile)

const CHROME = 'com.android.chrome'
const GBOARD = 'com.google.android.inputmethod.latin'
const CDP_PORT = 9222

export type ProbeCase = {
  name: string
  url: string
  /** The CSS selector of the editable whose first block the probe taps into. */
  editable: string
}

const DEMO = 'http://localhost:8765'
const EDITABLE = '[data-pt-editor], [contenteditable="true"]'

/**
 * The cases, one variable apart: `pte` is the demo page as the recordings use it, `pte-placeholder`
 * adds the playground's `renderPlaceholder`, `pte-uninitialised` starts without `initialValue` as the
 * playground does, `pte-placeholder-uninitialised` has both, `plain` is a plain `contenteditable` control,
 * `playground` the deployed playground.
 */
export const CASES: ProbeCase[] = [
  {name: 'plain', url: `${DEMO}/plain.html`, editable: EDITABLE},
  {name: 'pte', url: `${DEMO}/pte.html`, editable: EDITABLE},
  {
    name: 'pte-placeholder',
    url: `${DEMO}/pte.html?placeholder=1`,
    editable: EDITABLE,
  },
  {
    name: 'pte-uninitialised',
    url: `${DEMO}/pte.html?initial=none`,
    editable: EDITABLE,
  },
  {
    name: 'pte-placeholder-uninitialised',
    url: `${DEMO}/pte.html?placeholder=1&initial=none`,
    editable: EDITABLE,
  },
  {
    name: 'playground',
    url: 'https://playground.portabletext.org/',
    editable: '[data-pt-editor]',
  },
]

/** Runs of each case. */
export const RUNS = 3

/** One run's cap: Chrome's start, the page load over the network, the dumps and 12 taps with a dump each. */
export const RUN_SECONDS = 240

async function adb(args: string[], seconds = 30): Promise<string> {
  const {stdout} = await execFileAsync('adb', args, {
    timeout: seconds * 1000,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  })
  return stdout
}

async function adbBuffer(args: string[], seconds = 30): Promise<Buffer> {
  const {stdout} = await execFileAsync('adb', args, {
    timeout: seconds * 1000,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'buffer',
  })
  return stdout
}

/** The system uiautomator's dump of the whole screen. */
async function dumpScreen(): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await adb(
        ['shell', 'uiautomator', 'dump', '/data/local/tmp/probe.xml'],
        30,
      )
      const xml = await adb(['shell', 'cat', '/data/local/tmp/probe.xml'])
      if (xml.includes('<hierarchy')) {
        return xml
      }
    } catch {
      // A uiautomator2 server left running holds the accessibility connection; stop it and retry.
      await adb(['shell', 'pkill -f com.wetest.uia2 || true']).catch(
        () => undefined,
      )
    }
    await sleep(1000)
  }
  throw new Error('uiautomator dump failed four times')
}

type Node = {attrs: Record<string, string>}

function nodes(xml: string): Node[] {
  const out: Node[] = []
  for (const match of xml.matchAll(/<node\s([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {}
    for (const attr of match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)) {
      attrs[attr[1]!] = attr[2]!
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&amp;', '&')
    }
    out.push({attrs})
  }
  return out
}

function center(bounds: string): [number, number] {
  const [left, top, right, bottom] = bounds.match(/\d+/g)!.map(Number) as [
    number,
    number,
    number,
    number,
  ]
  return [Math.floor((left + right) / 2), Math.floor((top + bottom) / 2)]
}

/** Gboard's keys by content-desc, and its Shift key's content-desc. */
function gboard(xml: string): {
  keys: Map<string, [number, number]>
  shift: string | null
} {
  const keys = new Map<string, [number, number]>()
  let shift: string | null = null
  for (const {attrs} of nodes(xml)) {
    if (attrs.package !== GBOARD) {
      continue
    }
    const label = attrs['content-desc'] || attrs.text
    if (attrs['resource-id']?.endsWith(':id/key_pos_shift')) {
      shift = label ?? ''
    }
    if (label && attrs.bounds && !keys.has(label)) {
      keys.set(label, center(attrs.bounds))
    }
  }
  return {keys, shift}
}

/** The Shift state a dump shows: Gboard labels the key `Shift enabled` and its letter keys in capitals while it is on. */
function shiftState(xml: string): {
  shiftKey: string | null
  hKey: 'H' | 'h' | null
} {
  const {keys, shift} = gboard(xml)
  return {
    shiftKey: shift,
    hKey: keys.has('H') ? 'H' : keys.has('h') ? 'h' : null,
  }
}

async function tap([x, y]: [number, number]): Promise<void> {
  await adb(['shell', 'input', 'tap', String(x), String(y)])
}

async function tapKey(label: string): Promise<{xml: string}> {
  const xml = await dumpScreen()
  const {keys} = gboard(xml)
  const position = keys.get(label) ?? keys.get(label.toUpperCase())
  if (!position) {
    throw new Error(
      `no Gboard key ${label}, keys: ${[...keys.keys()].slice(0, 60).join(' ')}`,
    )
  }
  await tap(position)
  await sleep(400)
  return {xml}
}

/** Evaluate `expression` in the Chrome tab whose URL is `url`, over the forwarded DevTools socket. */
async function cdp(url: string, expression: string): Promise<unknown> {
  let last: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`, {
        signal: AbortSignal.timeout(10_000),
      })
      const targets = (await response.json()) as Array<{
        type?: string
        url?: string
        webSocketDebuggerUrl?: string
      }>
      const page = targets.find(
        (target) => target.type === 'page' && target.url === url,
      )
      if (!page?.webSocketDebuggerUrl) {
        throw new Error(
          `no tab for ${url}: ${targets.map((target) => target.url).join(', ')}`,
        )
      }
      const socketUrl = new URL(page.webSocketDebuggerUrl)
      socketUrl.host = `127.0.0.1:${CDP_PORT}`
      return await new Promise((resolve, reject) => {
        const socket = new WebSocket(socketUrl)
        const timer = setTimeout(() => {
          socket.close()
          reject(new Error('cdp timeout'))
        }, 15_000)
        socket.onopen = () =>
          socket.send(
            JSON.stringify({
              id: 1,
              method: 'Runtime.evaluate',
              params: {expression, returnByValue: true, awaitPromise: true},
            }),
          )
        socket.onmessage = (message) => {
          const reply = JSON.parse(String(message.data)) as {
            id?: number
            result?: {
              result?: {value?: unknown}
              exceptionDetails?: unknown
            }
            error?: unknown
          }
          if (reply.id !== 1) {
            return
          }
          clearTimeout(timer)
          socket.close()
          if (reply.error || reply.result?.exceptionDetails) {
            reject(
              new Error(
                JSON.stringify(reply.error ?? reply.result?.exceptionDetails),
              ),
            )
          } else {
            resolve(reply.result?.result?.value)
          }
        }
        socket.onerror = () => {
          clearTimeout(timer)
          reject(new Error('cdp socket error'))
        }
      })
    } catch (error) {
      last = error
      await adb([
        'forward',
        `tcp:${CDP_PORT}`,
        'localabstract:chrome_devtools_remote',
      ]).catch(() => undefined)
      await sleep(1500)
    }
  }
  throw last
}

/**
 * Page-side helpers, installed once the page loaded: the editable and its first block, a description of
 * focus, selection and the text before the caret, and a logger of `beforeinput` and `input`.
 */
function installScript(editable: string): string {
  return `(() => {
  const describeNode = (node) => node === null ? null : {
    name: node.nodeName,
    text: (node.textContent ?? '').slice(0, 120),
    editable: node.nodeType === 1 ? node.getAttribute('contenteditable') : node.parentElement?.getAttribute('contenteditable') ?? null,
  }
  window.__probeEditable = () => document.querySelector(${JSON.stringify(editable)})
  window.__probeBlock = () => {
    const root = window.__probeEditable()
    return root === null ? null : (root.querySelector('[data-pt-block]') ?? root.firstElementChild ?? root)
  }
  window.__probeDescribe = () => {
    const root = window.__probeEditable()
    const block = window.__probeBlock()
    const selection = getSelection()
    let textBeforeCaret = null
    if (root !== null && selection !== null && selection.rangeCount > 0 && root.contains(selection.anchorNode)) {
      const range = document.createRange()
      range.setStart(root, 0)
      range.setEnd(selection.anchorNode, selection.anchorOffset)
      textBeforeCaret = range.toString()
    }
    return {
      url: location.href,
      editables: document.querySelectorAll(${JSON.stringify(editable)}).length,
      activeElement: document.activeElement === null ? null : document.activeElement.nodeName + (document.activeElement.getAttribute('data-pt-editor') !== null ? '[data-pt-editor]' : '') + (document.activeElement.isContentEditable ? '[contenteditable]' : ''),
      editableFocused: root !== null && root.contains(document.activeElement),
      selection: selection === null || selection.rangeCount === 0 ? null : {
        anchor: describeNode(selection.anchorNode), anchorOffset: selection.anchorOffset,
        focus: describeNode(selection.focusNode), focusOffset: selection.focusOffset,
        insideEditable: root !== null && root.contains(selection.anchorNode),
      },
      textBeforeCaret,
      textBeforeCaretCodes: textBeforeCaret === null ? null : [...textBeforeCaret].map((c) => c.codePointAt(0).toString(16)),
      editableAttributes: root === null ? null : Object.fromEntries([...root.attributes].filter((a) => a.name !== 'style' && a.name !== 'class').map((a) => [a.name, a.value])),
      blockText: block === null ? null : block.textContent,
      blockHtml: block === null ? null : block.outerHTML.slice(0, 3000),
      editableText: root === null ? null : root.textContent.slice(0, 300),
    }
  }
  if (!window.__probeLog) {
    window.__probeLog = []
    for (const type of ['beforeinput', 'input', 'compositionstart', 'compositionend', 'selectionchange']) {
      document.addEventListener(type, (event) => {
        const block = window.__probeBlock()
        const entry = {type, t: Math.round(performance.now())}
        if (type === 'beforeinput' || type === 'input') {
          entry.inputType = event.inputType
          entry.data = event.data
          entry.isComposing = event.isComposing
          entry.targetRanges = (event.getTargetRanges?.() ?? []).map((range) => ({
            start: describeNode(range.startContainer), startOffset: range.startOffset,
            end: describeNode(range.endContainer), endOffset: range.endOffset,
          }))
        }
        if (type === 'selectionchange') {
          const selection = getSelection()
          entry.anchor = selection?.anchorNode ? describeNode(selection.anchorNode) : null
          entry.anchorOffset = selection?.anchorOffset ?? null
        }
        entry.blockText = block === null ? null : block.textContent
        window.__probeLog.push(entry)
      }, true)
    }
  }
  return true
})()`
}

function isNull(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

async function waitForEditable(url: string, editable: string): Promise<void> {
  for (let check = 0; check < 60; check++) {
    try {
      const ready = await cdp(
        url,
        `document.readyState === 'complete' && document.querySelector(${JSON.stringify(editable)}) !== null`,
      )
      if (ready === true) {
        return
      }
    } catch {
      // The tab is not listed yet.
    }
    await sleep(1000)
  }
  throw new Error(`no ${editable} in ${url} after 60 s`)
}

/** Chrome's first-run and promo screens, should one show over the page. */
const CHROME_SCREENS = [
  'Use without an account',
  'Accept & continue',
  'No thanks',
  'No, thanks',
  'Got it',
  'Continue',
  'Skip',
]

async function dismissChromeScreens(): Promise<string[]> {
  const dismissed: string[] = []
  for (let screen = 0; screen < 4; screen++) {
    const hit = nodes(await dumpScreen()).find(
      ({attrs}) =>
        attrs.package === CHROME &&
        CHROME_SCREENS.includes(attrs.text ?? '') &&
        attrs.bounds,
    )
    if (!hit) {
      break
    }
    dismissed.push(hit.attrs.text!)
    await tap(center(hit.attrs.bounds!))
    await sleep(1500)
  }
  return dismissed
}

async function keyboardShown(): Promise<boolean> {
  for (let check = 0; check < 15; check++) {
    const dump = await adb(['shell', 'dumpsys', 'input_method'])
    if (
      dump.includes('mInputShown=true') ||
      dump.includes('mIsInputViewShown=true')
    ) {
      return true
    }
    await sleep(1000)
  }
  return false
}

function outDir(): string {
  return process.env.THUMBJAR_OUT_DIR ?? 'out'
}

/** Chrome and Gboard `versionName` and the build, into `out/probe-versions.txt`. */
export async function recordVersions(): Promise<void> {
  const lines: string[] = []
  for (const name of [CHROME, GBOARD]) {
    const dump = await adb(['shell', 'dumpsys', 'package', name])
    lines.push(
      `${name}: ${[...dump.matchAll(/versionName=(\S+)/g)].map((m) => m[1]).join(' ')}`,
    )
  }
  lines.push(
    `build: ${(await adb(['shell', 'getprop', 'ro.build.fingerprint'])).trim()}`,
  )
  mkdirSync(outDir(), {recursive: true})
  writeFileSync(join(outDir(), 'probe-versions.txt'), `${lines.join('\n')}\n`)
}

/**
 * One run of `probeCase`: open it fresh, tap the editable's first block, record the state Gboard and the
 * page are in before the first key, type `hello` Space `world` Space, and record what came out.
 */
export async function probe(probeCase: ProbeCase, run: number): Promise<void> {
  const dir = join(outDir(), 'probe', `${probeCase.name}-${run}`)
  mkdirSync(dir, {recursive: true})
  // A fresh hash per run, so the DevTools target is this run's tab, not one Chrome restored.
  const url = `${probeCase.url}#probe-${probeCase.name}-${run}`
  const result: Record<string, unknown> = {case: probeCase.name, run, url}
  try {
    await adb(['shell', 'am', 'force-stop', CHROME])
    await adb(['reverse', 'tcp:8765', 'tcp:8765'])
    await adb([
      'forward',
      `tcp:${CDP_PORT}`,
      'localabstract:chrome_devtools_remote',
    ])
    await adb([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      `'${url}'`,
      CHROME,
    ])
    await sleep(4000)
    result.dismissed = await dismissChromeScreens()
    await waitForEditable(url, probeCase.editable)
    // The playground renders its editors after the bundle runs; let it settle.
    await sleep(3000)
    await cdp(url, installScript(probeCase.editable))
    const beforeTap = await cdp(url, 'window.__probeDescribe()')
    writeFileSync(
      join(dir, 'page-before-tap.json'),
      JSON.stringify(beforeTap, null, 2),
    )

    // The first block's left edge, a few px in, vertically centred, scrolled to the middle of the viewport.
    const target = (await cdp(
      url,
      `(() => {
        const block = window.__probeBlock()
        block.scrollIntoView({block: 'center'})
        const rect = block.getBoundingClientRect()
        return {x: rect.left + Math.min(12, rect.width / 4), y: rect.top + rect.height / 2, dpr: devicePixelRatio, innerHeight, screenHeight: screen.height}
      })()`,
    )) as {
      x: number
      y: number
      dpr: number
      innerHeight: number
      screenHeight: number
    }
    const offset = (target.screenHeight - target.innerHeight) * target.dpr
    const point: [number, number] = [
      Math.trunc(target.x * target.dpr),
      Math.trunc(target.y * target.dpr + offset),
    ]
    result.tap = point
    await tap(point)
    let shown = await keyboardShown()
    if (!shown) {
      await tap(point)
      shown = await keyboardShown()
    }
    result.keyboardShown = shown
    await sleep(1500)

    const beforeKeys = (await cdp(url, 'window.__probeDescribe()')) as Record<
      string,
      unknown
    >
    writeFileSync(
      join(dir, 'page-before-keys.json'),
      JSON.stringify(beforeKeys, null, 2),
    )
    const ime = [
      '== dumpsys input_method',
      await adb(['shell', 'dumpsys', 'input_method']),
      '== dumpsys activity service LatinIME',
      await adb([
        'shell',
        'dumpsys',
        'activity',
        'service',
        `${GBOARD}/com.android.inputmethod.latin.LatinIME`,
      ]).catch((error: unknown) => String(error)),
    ].join('\n')
    writeFileSync(join(dir, 'ime.txt'), ime)
    result.initialCapsMode = [
      ...new Set(
        [...ime.matchAll(/initialCapsMode=(\S+)/g)].map((match) => match[1]),
      ),
    ]
    result.inputType = [
      ...new Set([...ime.matchAll(/inputType=(\S+)/g)].map((m) => m[1])),
    ]
    writeFileSync(
      join(dir, 'before-keys.png'),
      await adbBuffer(['exec-out', 'screencap', '-p']),
    )

    const keys: string[] = [
      ...'hello',
      'Space',
      ...'world',
      'Space',
    ]
    for (const [index, key] of keys.entries()) {
      const {xml} = await tapKey(key)
      if (index === 0) {
        writeFileSync(join(dir, 'keyboard-before.xml'), xml)
        result.shiftBeforeFirstLetter = shiftState(xml)
      }
      if (index === 1) {
        writeFileSync(join(dir, 'keyboard-after-h.xml'), xml)
        result.shiftAfterFirstLetter = shiftState(xml)
      }
    }
    await sleep(1500)
    const log = (await cdp(url, 'window.__probeLog')) as unknown[]
    const after = (await cdp(url, 'window.__probeDescribe()')) as Record<
      string,
      unknown
    >
    writeFileSync(
      join(dir, 'log.json'),
      JSON.stringify({events: log, after}, null, 2),
    )
    writeFileSync(
      join(dir, 'final.png'),
      await adbBuffer(['exec-out', 'screencap', '-p']),
    )
    result.textBeforeCaretBeforeKeys = beforeKeys.textBeforeCaret
    result.selectionBeforeKeys = beforeKeys.selection
    result.focusedBeforeTap = (beforeTap as {editableFocused?: unknown})
      ?.editableFocused
    result.text = isNull(after.blockText) ? null : after.blockText
    result.firstBeforeinput = (
      log as Array<{type: string}>
    ).find((event) => event.type === 'beforeinput')
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    await adbBuffer(['exec-out', 'screencap', '-p'])
      .then((png) => writeFileSync(join(dir, 'error.png'), png))
      .catch(() => undefined)
  } finally {
    appendFileSync(
      join(outDir(), 'probe-results.jsonl'),
      `${JSON.stringify(result)}\n`,
    )
    await adb(['shell', 'am', 'force-stop', CHROME]).catch(() => undefined)
  }
  if (result.error !== undefined) {
    throw new Error(String(result.error))
  }
}

/** Declare the version record and `RUNS` runs of every case, interleaved so a drift over the job touches every case alike. */
export function defineProbe(): void {
  test('Probe: versions', async () => {
    await recordVersions()
  })
  const only = process.env.PROBE_CASES?.split(',').filter(Boolean)
  const cases = only
    ? CASES.filter((probeCase) => only.includes(probeCase.name))
    : CASES
  for (let run = 1; run <= RUNS; run++) {
    for (const probeCase of cases) {
      test(
        `Probe: ${probeCase.name} run ${run}`,
        async () => {
          await probe(probeCase, run)
        },
        RUN_SECONDS * 1000,
      )
    }
  }
}
