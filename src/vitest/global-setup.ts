import {rmSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import type {TestProject} from 'vitest/node'
import {adb} from '../device/adb.ts'
import {
  GLOBAL_SETUP_ADB_SECONDS,
  GLOBAL_SETUP_PAGE_SECONDS,
} from '../device/budget.ts'

/**
 * Remove the `verdict.json` an earlier run left in the project's out directory, then fail before any test
 * when there is no device to type on or no page to open.
 *
 * @public
 */
export default async function setup(
  project: Pick<TestProject, 'getProvidedContext'> & {
    config?: {env?: Record<string, unknown>}
  },
): Promise<void> {
  // Each test file merges its tests into the file, so one left from an earlier run would keep its files.
  // The verdict is a diagnostic, so failing to remove it never fails the run.
  if (project.config !== undefined) {
    const outDir = project.config.env?.THUMBJAR_OUT_DIR
    const verdict = join(
      typeof outDir === 'string' ? outDir : 'out',
      'verdict.json',
    )
    try {
      rmSync(verdict, {force: true})
    } catch (error) {
      console.warn(
        `${verdict} from an earlier run not removed: ${String(error)}`,
      )
    }
  }
  const {
    thumbjarPageUrl: pageUrl,
    thumbjarPageHint: pageHint,
    thumbjarDevice,
  } = project.getProvidedContext()
  if (thumbjarDevice === 'ios') {
    try {
      createRequire(import.meta.url).resolve('webdriverio')
      const response = await fetch('http://127.0.0.1:4723/status', {
        signal: AbortSignal.timeout(GLOBAL_SETUP_PAGE_SECONDS * 1000),
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch {
      throw new Error(
        'iOS needs the optional `webdriverio` peer dependency and an Appium XCUITest server on port 4723, see the thumbjar README.',
      )
    }
  } else {
    const state = await adb(['get-state'], GLOBAL_SETUP_ADB_SECONDS).then(
      (stdout) => stdout.trim(),
      (error: NodeJS.ErrnoException) =>
        error.code === 'ENOENT' ? 'adb is not on PATH' : error.message.trim(),
    )
    if (state !== 'device') {
      throw new Error(
        `No Android device to type on (${state}). Boot an API 36 Play Store emulator and run \`thumbjar prepare\`, see the thumbjar README.`,
      )
    }
  }
  const page = await fetch(pageUrl, {
    signal: AbortSignal.timeout(GLOBAL_SETUP_PAGE_SECONDS * 1000),
  }).then(
    (response) => `HTTP ${response.status}`,
    (error: Error) => error.message,
  )
  if (page !== 'HTTP 200') {
    throw new Error(`No test page at ${pageUrl} (${page}). ${pageHint}`)
  }
}
