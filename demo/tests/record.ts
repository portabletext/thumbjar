import {spawn, execFile} from 'node:child_process'
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {promisify} from 'node:util'
import {runOnDevice, type Run} from 'thumbjar'
import {deviceTestFileSeconds} from 'thumbjar/vitest'
import {test} from 'vitest'

const execFileAsync = promisify(execFile)

/** Vitest's per-test timeout in a device project, the `runOnDevice` worst case plus a carried-over cleanup. */
const DEVICE_TEST_SECONDS = deviceTestFileSeconds(2) - deviceTestFileSeconds(1)

/**
 * The recording's own worst case around `runOnDevice`: the two settings writes and the `rm` (30 s each),
 * the 1 s start and 2 s tail, the `pkill` (10 s), the wait for adb to exit (10 s), the 2 s finalize, the
 * settings reset (10 s) and the pull (60 s), rounded up.
 */
const RECORDING_SECONDS = 200

/**
 * The tests a record file declares in its `thumbjar-test-count` line: the one test, plus one more so
 * `thumbjar run`'s cap for the file covers the test's longer timeout (`DEVICE_TEST_SECONDS` +
 * `RECORDING_SECONDS`, under two device tests).
 */
const DECLARED_COUNT = 2

/** The device path `screenrecord` writes to. */
const DEVICE_FILE = '/sdcard/demo.mp4'

/** One short adb call, cut off after `seconds` so the recording never eats the test's budget. */
async function adb(args: string[], seconds = 30): Promise<void> {
  await execFileAsync('adb', args, {timeout: seconds * 1000})
}

/**
 * Declare the one recording test for `editor`: type `hello` Space `world` Space into an empty field on
 * English Gboard while `adb shell screenrecord` records the screen, then pull the video to
 * `out/record-<editor>.mp4` and the run's text to `out/record-<editor>.json`. Nothing is asserted.
 * `declaredCount` must be the file's `// thumbjar-test-count:` line, which `thumbjar run` reads to size the
 * test stage's timeout because the `test(` call lives here; see `DECLARED_COUNT`.
 */
export function defineRecording(
  editor: 'slate' | 'pte',
  declaredCount: number,
): void {
  if (declaredCount !== DECLARED_COUNT) {
    throw new Error(
      `record.${editor}.test.ts declares ${declaredCount} tests but defineRecording needs ${DECLARED_COUNT}; update its thumbjar-test-count line`,
    )
  }
  test(
    `Record: ${editor}: hello world in an empty field`,
    async (context) => {
      const outDir = process.env.THUMBJAR_OUT_DIR ?? 'out'
      mkdirSync(outDir, {recursive: true})
      const url = new URL(`http://localhost:8765/${editor}.html`)
      url.searchParams.set('big', '1')

      await adb(['shell', 'settings', 'put', 'system', 'show_touches', '1'])
      await adb(['shell', 'rm', '-f', DEVICE_FILE])
      const recorder = spawn(
        'adb',
        [
          'shell',
          'screenrecord',
          '--bit-rate',
          '6000000',
          '--time-limit',
          '170',
          DEVICE_FILE,
        ],
        {stdio: ['ignore', 'inherit', 'inherit']},
      )
      const exited = new Promise<void>((resolve) => {
        recorder.once('exit', () => resolve())
        recorder.once('error', () => resolve())
      })
      // Give screenrecord a moment to start its encoder before the driver opens Chrome.
      await sleep(1000)

      let run: Run | undefined
      let error: string | undefined
      try {
        run = await runOnDevice(context, {
          keyboard: 'en',
          url: url.href,
          prefix: '',
          steps: [
            {type: 'compose', letters: 'hello', commit: 'space'},
            {type: 'compose', letters: 'world', commit: 'space'},
          ],
        })
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught)
      } finally {
        // Let the last frame with the committed text land in the video.
        await sleep(2000)
        // SIGINT on the device makes screenrecord write the mp4's moov atom; SIGINT to the local adb
        // client alone may only hang up the shell. Then wait for adb to exit and the file to be finalized.
        await adb(['shell', 'pkill', '-INT', 'screenrecord'], 10).catch(
          () => undefined,
        )
        recorder.kill('SIGINT')
        await Promise.race([exited, sleep(10_000)])
        if (recorder.exitCode === null && recorder.signalCode === null) {
          recorder.kill('SIGKILL')
        }
        await sleep(2000)
        await adb(
          ['shell', 'settings', 'put', 'system', 'show_touches', '0'],
          10,
        ).catch(() => undefined)
      }

      writeFileSync(
        join(outDir, `record-${editor}.json`),
        `${JSON.stringify(
          run === undefined
            ? {editor, url: url.href, error}
            : {editor, url: url.href, text: run.text, selection: run.selection},
          null,
          2,
        )}\n`,
      )
      await adb(['pull', DEVICE_FILE, join(outDir, `record-${editor}.mp4`)], 60)
    },
    (DEVICE_TEST_SECONDS + RECORDING_SECONDS) * 1000,
  )
}
