// `verdict.json` in the out directory: every test of the run, its outcome and why, in one file. The setup
// file `deviceProject` adds merges each test file's entries into it after the file's tests.

import {randomBytes} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import type {DriverRun} from '../driver.ts'
import type {PageEvent, StepRecord} from '../steps.ts'
import {OUTCOMES, type Outcome} from './summary.ts'

/**
 * The shape of `verdict.json`, which the setup file of `deviceProject` writes to its `outDir`. It holds
 * every test of every test file the run ran so far, a file's entries replaced when that file runs again in
 * the same project, and an entry dropped once its test file no longer exists.
 *
 * @public
 */
export type Verdict = {
  version: 1
  /** The thumbjar version that wrote the file. */
  thumbjar: string
  /** How many tests ended in each outcome, over every file. */
  counts: Record<Outcome, number>
  tests: Array<{
    /** The Vitest project that ran the test, empty for an unnamed one. */
    project: string
    /** The device the test ran on. */
    platform: 'android' | 'ios'
    /** The test file, as Vitest names it. */
    file: string
    /** The test's name with the names of its suites. */
    name: string
    /** The outcome the job summary counts the test by. Absent for a test that did not run. */
    outcome?: Outcome
    /**
     * Why it ended so, for a test that did not pass. For `inconclusive`, `device offline` and `driver
     * fault`, the driver's own reason when it gave one, else the message of the error the test's last
     * driver call threw, or the test's abort reason when it timed out before that call settled, never an
     * error the test raised after it caught that one. For `failed`, the page's
     * exception when the page threw while the driver typed, else the test's first error.
     */
    reason?: string
    /**
     * The first step of the last attempt that did not end `done`, when a step of that attempt failed and
     * the test's last call threw that failure. `index` counts from 0.
     */
    firstDivergingStep?: {
      index: number
      type: StepRecord['type']
      status: StepRecord['status']
      reason?: string
      keys: string[]
      events: PageEvent[]
      textAfter: string | null
    }
    /**
     * How many keys the driver tapped and how many events the page recorded in each step of the last
     * attempt of the test's last call.
     */
    taps?: Array<{keys: number; events: number}>
    /**
     * The files every driver call of the test wrote in this run, relative to the out directory. The list
     * is taken once the test's file ended, so a test its timeout cut off lists only the files its calls
     * wrote before then, and not those the driver's cleanup still writes afterwards, such as the iOS
     * page source, screenshot and step JSON.
     */
    artifacts: string[]
  }>
}

type VerdictTest = Verdict['tests'][number]

/** A test's entry from its final result, the last driver call it made and the artifacts of all its calls. */
export function verdictTest({
  project,
  platform,
  file,
  name,
  outcome,
  errorMessage,
  run,
  fault,
  records,
  artifacts,
}: {
  project: string
  platform: VerdictTest['platform']
  file: string
  name: string
  outcome: Outcome | undefined
  errorMessage: string | undefined
  /** The test's last driver call, which ended it. */
  run: DriverRun | undefined
  /** The message of the error `run` threw, absent when it returned. */
  fault?: string | undefined
  /** The step records of the last attempt of `run`, when one of its steps failed. */
  records?: StepRecord[] | undefined
  artifacts: string[]
}): VerdictTest {
  const reason = reasonFor(outcome, errorMessage, run, fault)
  const index = records?.findIndex((record) => record.status !== 'done') ?? -1
  const diverging = records?.[index]
  return {
    project,
    platform,
    file,
    name,
    ...(outcome === undefined ? {} : {outcome}),
    ...(reason === undefined || reason === ''
      ? {}
      : {reason: stripVTControlCharacters(reason)}),
    ...(diverging === undefined
      ? {}
      : {
          firstDivergingStep: {
            index,
            type: diverging.type,
            status: diverging.status,
            ...(diverging.reason === undefined
              ? {}
              : {reason: diverging.reason}),
            keys: diverging.keys,
            events: diverging.events,
            textAfter: diverging.textAfter,
          },
        }),
    ...(run?.taps === undefined
      ? {}
      : {
          taps: run.taps.map((step) => ({
            keys: step.keys.length,
            events: step.events.length,
          })),
        }),
    artifacts,
  }
}

// The reason from the same source as the outcome, so it never contradicts it: an outcome the driver's call
// decided quotes the driver, whose reason can differ from the error an earlier attempt threw, else the
// fault the call threw. The test's own error is never used there: a test that caught the fault can fail
// on an unrelated assertion later.
function reasonFor(
  outcome: Outcome | undefined,
  errorMessage: string | undefined,
  run: DriverRun | undefined,
  fault: string | undefined,
): string | undefined {
  switch (outcome) {
    case 'inconclusive':
    case 'device offline':
    case 'driver fault':
      return run?.reason ?? fault
    case 'failed':
      return run?.state === 'page-exception'
        ? (run.pageException ?? errorMessage)
        : errorMessage
    default:
      return undefined
  }
}

/**
 * Write `tests` of `file` into `<outDir>/verdict.json`, in place of the entries an earlier run of `file`
 * in the same project left there, drop the entries of `project` whose test files no longer exist under
 * `root`, and count every outcome again. Another project's entries are kept as they are, since its root
 * can differ. Test files run one at a time, so no other file writes it meanwhile.
 */
export function writeVerdict({
  outDir,
  root,
  project,
  file,
  tests,
  thumbjar,
}: {
  outDir: string
  /** The directory Vitest names the test files of `project` relative to. */
  root: string
  project: string
  file: string
  tests: VerdictTest[]
  thumbjar: string
}): void {
  const path = join(outDir, 'verdict.json')
  const earlier = existsSync(path) ? readVerdict(path) : undefined
  const all = [
    ...(earlier?.tests.filter(
      (test) =>
        insideRoot(root, test.file) &&
        (test.project !== project ||
          (test.file !== file && existsSync(resolve(root, test.file)))),
    ) ?? []),
    ...tests,
  ]
  const verdict: Verdict = {
    version: 1,
    thumbjar,
    counts: Object.fromEntries(
      OUTCOMES.map((outcome) => [
        outcome,
        all.filter((test) => test.outcome === outcome).length,
      ]),
    ) as Record<Outcome, number>,
    tests: all,
  }
  mkdirSync(outDir, {recursive: true})
  // A reader never sees half a file. The temporary name is unique and `wx` refuses an existing path, so a
  // file or symlink planted beside the verdict is never written through.
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(verdict, null, 2)}\n`, {
      flag: 'wx',
    })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, {force: true})
    throw error
  }
}

// An earlier entry names its test file relative to its project's root. One that is absolute or climbs out
// of the root is not one thumbjar wrote, and the merge would probe a path outside the project for it.
function insideRoot(root: string, file: string): boolean {
  if (isAbsolute(file)) {
    return false
  }
  const path = relative(root, resolve(root, file))
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

// An unreadable file or one that is not a version 1 verdict is replaced.
function readVerdict(path: string): Verdict | undefined {
  let verdict: unknown
  try {
    verdict = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.warn(`${path} from earlier files not read: ${String(error)}`)
    return undefined
  }
  if (!isVerdict(verdict)) {
    console.warn(
      `${path} from earlier files is not a version 1 verdict, replaced`,
    )
    return undefined
  }
  return verdict
}

function isVerdict(value: unknown): value is Verdict {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.tests) &&
    value.tests.every(isVerdictTest)
  )
}

// The fields the merge and the counts read. The rest is copied as the earlier file had it.
function isVerdictTest(value: unknown): value is VerdictTest {
  return (
    isRecord(value) &&
    typeof value.project === 'string' &&
    (value.platform === 'android' || value.platform === 'ios') &&
    typeof value.file === 'string' &&
    typeof value.name === 'string' &&
    (value.outcome === undefined ||
      (OUTCOMES as readonly unknown[]).includes(value.outcome)) &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every((artifact) => typeof artifact === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
