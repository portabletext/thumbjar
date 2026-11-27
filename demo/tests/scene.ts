// The Enter scene, driven tap by tap like `probe.ts` and not through `runOnDevice`: on the empty demo
// page of `editor`, tap the field, type `hello` Space `world` Space, tap Gboard's Enter key, then type
// `hello` Space `again` Space. Before the first letter of each line the screen dump is saved, and its
// Shift key (`Shift enabled` while on, with capital letter keys) gives Gboard's Shift state.
//
// Per run it writes `out/scene/<editor>-<run>/`:
// - `keyboard-line1.xml`, `keyboard-line2.xml`: the dumps before `h` of each line
// - `page-line1.json`, `page-line2.json`: focus, selection and the text before the caret at that moment
// - `line1.png`, `line2.png`, `final.png`
// - `log.json`: every `beforeinput` and `input` with target ranges, and the page's state at the end
// and appends one line per run to `out/scene-results.jsonl` with both blocks' text and both Shift states.
// Run 1 of each editor is also screen-recorded to `out/record-<editor>.mp4`.

import {spawn} from 'node:child_process'
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {test} from 'vitest'
import {
  adb,
  adbBuffer,
  CDP_PORT,
  CHROME,
  cdp,
  center,
  dismissChromeScreens,
  dumpScreen,
  gboard,
  installScript,
  keyboardShown,
  outDir,
  recordVersions,
  shiftState,
  tap,
  waitForEditable,
} from './probe.ts'

export type SceneEditor = 'slate' | 'pte'

/** Runs per editor. Only the first is recorded. */
export const SCENE_RUNS = 3

/** One run's cap: Chrome's start, a dump before every one of 24 taps, and the recording around it. */
export const SCENE_RUN_SECONDS = 360

// Both pages' editable root; the first block is its first element (`probe.ts`'s `__probeBlock`).
const EDITABLE = '[contenteditable="true"]'

const LINES: string[][] = [
  [...'hello', 'Space', ...'world', 'Space'],
  [...'hello', 'Space', ...'again', 'Space'],
]

/** The device path `screenrecord` writes to. */
const DEVICE_FILE = '/sdcard/demo.mp4'

/** The caption's environment, `Chrome 145, Gboard 17.2`, from the installed versions. */
function caption(versions: {chrome: string; gboard: string}): string {
  const major = (version: string, parts: number) =>
    version.split(/[.-]/).slice(0, parts).join('.')
  return `Chrome ${major(versions.chrome, 1)}, Gboard ${major(versions.gboard, 2)}`
}

/** Send SIGINT to screenrecord on the device and wait up to 20 s for it to exit, so the mp4 gets its moov atom. */
async function stopRecorder(): Promise<string> {
  try {
    await adb(['shell', 'kill -INT $(pidof screenrecord)'], 10)
  } catch (caught) {
    return `kill failed: ${caught instanceof Error ? caught.message : String(caught)}`
  }
  for (let waited = 0; waited < 20_000; waited += 500) {
    const pid = await adb(['shell', 'pidof screenrecord || true'], 10)
    if (pid.trim() === '') {
      return `exited after ${waited} ms`
    }
    await sleep(500)
  }
  return 'still running after 20 s'
}

type PageDescription = {
  textBeforeCaret?: string | null
  editableFocused?: boolean
  [key: string]: unknown
}

/** One run of the scene on `editor`'s page, recorded when `record` is set. */
async function scene(
  editor: SceneEditor,
  run: number,
  env: string,
  record: boolean,
): Promise<void> {
  const dir = join(outDir(), 'scene', `${editor}-${run}`)
  mkdirSync(dir, {recursive: true})
  const page = new URL(`http://localhost:8765/${editor}.html`)
  page.searchParams.set('big', '1')
  page.searchParams.set('env', env)
  page.hash = `scene-${editor}-${run}`
  const url = page.href
  const result: Record<string, unknown> = {editor, run, url, recorded: record}
  let recorder: ReturnType<typeof spawn> | undefined
  try {
    await adb(['shell', 'am', 'force-stop', CHROME])
    await adb(['reverse', 'tcp:8765', 'tcp:8765'])
    await adb([
      'forward',
      `tcp:${CDP_PORT}`,
      'localabstract:chrome_devtools_remote',
    ])
    // The dump before the recording starts, so uiautomator2's start is not in the video.
    await dumpScreen()
    if (record) {
      await adb(['shell', 'settings', 'put', 'system', 'show_touches', '1'])
      await adb(['shell', 'rm', '-f', DEVICE_FILE])
      recorder = spawn(
        'adb',
        [
          'shell',
          'screenrecord',
          '--bit-rate',
          '6000000',
          '--time-limit',
          '180',
          DEVICE_FILE,
        ],
        {stdio: ['ignore', 'inherit', 'inherit']},
      )
      await sleep(1000)
    }
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
    await waitForEditable(url, EDITABLE)
    await sleep(1500)
    await cdp(url, installScript(EDITABLE))

    const target = (await cdp(
      url,
      `(() => {
        const rect = window.__probeBlock().getBoundingClientRect()
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
    if (!(await keyboardShown())) {
      await tap(point)
      if (!(await keyboardShown())) {
        throw new Error('Gboard did not show after two taps into the field')
      }
    }
    await sleep(1500)

    const shift: unknown[] = []
    for (const [index, keys] of LINES.entries()) {
      const line = index + 1
      if (index > 0) {
        // Gboard's Enter key, by its resource id: its label follows the field's `enterkeyhint`.
        const xml = await dumpScreen()
        const enter = xml
          .split('<node ')
          .find((node) => node.includes(':id/key_pos_ime_action"'))
        const bounds = enter && /bounds="([^"]+)"/.exec(enter)?.[1]
        if (!bounds) {
          throw new Error('no Gboard Enter key (key_pos_ime_action)')
        }
        await tap(center(bounds))
        await sleep(1500)
      }
      for (const [position, key] of keys.entries()) {
        const xml = await dumpScreen()
        if (position === 0) {
          writeFileSync(join(dir, `keyboard-line${line}.xml`), xml)
          const state = shiftState(xml)
          shift.push(state)
          writeFileSync(
            join(dir, `page-line${line}.json`),
            JSON.stringify(
              (await cdp(url, 'window.__probeDescribe()')) as PageDescription,
              null,
              2,
            ),
          )
          writeFileSync(
            join(dir, `line${line}.png`),
            await adbBuffer(['exec-out', 'screencap', '-p']),
          )
        }
        const {keys: labels} = gboard(xml)
        const at = labels.get(key) ?? labels.get(key.toUpperCase())
        if (!at) {
          throw new Error(
            `no Gboard key ${key} on line ${line}, keys: ${[...labels.keys()].slice(0, 60).join(' ')}`,
          )
        }
        await tap(at)
        await sleep(400)
      }
      await sleep(1500)
    }
    result.shift = shift
    await sleep(1000)
    const state = (await cdp(url, 'window.__state()')) as {
      text?: string | null
      state?: unknown
    }
    const log = await cdp(url, 'window.__probeLog')
    writeFileSync(
      join(dir, 'log.json'),
      JSON.stringify({events: log, state}, null, 2),
    )
    writeFileSync(
      join(dir, 'final.png'),
      await adbBuffer(['exec-out', 'screencap', '-p']),
    )
    result.text = state.text ?? null
    result.blocks =
      typeof state.text === 'string' ? state.text.split('\n') : null
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    await adbBuffer(['exec-out', 'screencap', '-p'])
      .then((png) => writeFileSync(join(dir, 'error.png'), png))
      .catch(() => undefined)
  } finally {
    if (recorder !== undefined) {
      // Let the last frame with the committed text land in the video.
      await sleep(2000)
      result.screenrecord = await stopRecorder()
      await Promise.race([
        new Promise((resolve) => recorder!.once('exit', resolve)),
        sleep(10_000),
      ])
      if (recorder.exitCode === null && recorder.signalCode === null) {
        recorder.kill('SIGKILL')
      }
      await sleep(2000)
      await adb(
        ['shell', 'settings', 'put', 'system', 'show_touches', '0'],
        10,
      ).catch(() => undefined)
      await adb(
        ['pull', DEVICE_FILE, join(outDir(), `record-${editor}.mp4`)],
        60,
      ).catch((error: unknown) => {
        result.pullError = String(error)
      })
    }
    appendFileSync(
      join(outDir(), 'scene-results.jsonl'),
      `${JSON.stringify(result)}\n`,
    )
    await adb(['shell', 'am', 'force-stop', CHROME]).catch(() => undefined)
  }
  if (result.error !== undefined) {
    throw new Error(String(result.error))
  }
}

/**
 * Declare the version record and `SCENE_RUNS` runs of the scene on `editor`, the first recorded. The
 * versions go to `out/scene-versions.txt` and into the page's caption.
 */
export function defineScene(editor: SceneEditor): void {
  let env: string | undefined
  test('Scene: versions', async () => {
    env = caption(await recordVersions('scene-versions.txt'))
  })
  for (let run = 1; run <= SCENE_RUNS; run++) {
    test(
      `Scene: ${editor}: hello world, Enter, hello again (run ${run})`,
      async () => {
        if (env === undefined) {
          throw new Error('the versions test did not run')
        }
        await scene(editor, run, env, run === 1)
      },
      SCENE_RUN_SECONDS * 1000,
    )
  }
}
