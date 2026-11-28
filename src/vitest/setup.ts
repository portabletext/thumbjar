import {appendFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {afterAll, inject, type RunnerTask, type RunnerTestCase} from 'vitest'
import {unstoppedProcesses} from '../device/adb.ts'
import {
  driverRuns,
  failedStepRecords,
  lastDriverRun,
  testArtifacts,
  thrownFault,
} from '../driver.ts'
import {outDir} from '../gboard/typing.ts'
import {summaryLines, tapsBlock, testOutcome} from './summary.ts'
import {verdictTest, writeVerdict} from './verdict.ts'

// Resolved by the package's own name, so it is found from `src` and from `dist` alike.
const {version} = createRequire(import.meta.url)('thumbjar/package.json') as {
  version: string
}

// oxlint-disable-next-line no-empty-pattern -- Vitest reads a hook's first argument as the fixtures it uses and takes only an object pattern, and this hook uses none
afterAll(({}, file) => {
  // Once the file's tests ended, so a test's final state is known and an expected failure prints nothing.
  for (const test of leafTests(file.tasks)) {
    const taps = lastDriverRun(test)?.taps
    if (test.result?.state === 'fail' && taps !== undefined) {
      console.error(tapsBlock(test.name, taps))
    }
  }
  const tests = leafTests(file.tasks).map((test) => ({
    test,
    run: lastDriverRun(test),
    // A skipped or todo test, or one skipped as it ran, ends neither passed nor failed.
    outcome:
      test.result?.state === 'pass' || test.result?.state === 'fail'
        ? testOutcome({
            passed: test.result.state === 'pass',
            fails: Boolean(test.fails),
            run: lastDriverRun(test),
          })
        : undefined,
  }))
  // The verdict is a diagnostic, so failing to write it never fails the file.
  try {
    const platform = inject('thumbjarDevice') === 'ios' ? 'ios' : 'android'
    // The hook of a setup file runs for the test file itself.
    const {projectName, filepath} = file.file
    const project = projectName ?? ''
    writeVerdict({
      outDir: outDir(),
      // Vitest names the file relative to the project's root.
      root: filepath.endsWith(file.name)
        ? filepath.slice(0, filepath.length - file.name.length)
        : process.cwd(),
      project,
      file: file.name,
      thumbjar: version,
      tests: tests.map(({test, run, outcome}) =>
        verdictTest({
          project,
          platform,
          file: file.name,
          name: test.fullTestName,
          outcome,
          errorMessage: test.result?.errors?.[0]?.message,
          run,
          fault: run === undefined ? undefined : thrownFault(run),
          records: run === undefined ? undefined : failedStepRecords(run),
          artifacts: testArtifacts(test),
        }),
      ),
    })
  } catch (error) {
    console.warn(`verdict.json not written: ${String(error)}`)
  }
  const summaryFile = inject('thumbjarSummaryFile')
  if (summaryFile) {
    appendFileSync(
      summaryFile,
      summaryLines(
        file.name,
        tests.map(({test, run, outcome}) => ({
          name: test.fullTestName,
          duration: test.result?.duration,
          errorMessage: test.result?.errors?.[0]?.message,
          pageException: run?.pageException,
          reason: run?.reason,
          ...(test.result?.state === 'fail' && run?.taps !== undefined
            ? {taps: run.taps, tapsName: test.name}
            : {}),
          outcome,
        })),
        driverRuns,
      ),
    )
  }
  const unstopped = unstoppedProcesses()
  if (unstopped.length > 0) {
    throw new Error(
      `${unstopped.join(', ')} outlived SIGKILL and may still have touched the device during later tests, so no result in this file can be trusted.`,
    )
  }
  const pageExceptions = driverRuns.filter(
    (run) => run.state === 'page-exception',
  )
  if (pageExceptions.length > 0) {
    throw new Error(
      `The page threw while the driver typed, which can be an editor failure, so it is not retried: ${pageExceptions.map((run) => `"${run.test}": ${run.pageException}`).join(', ')}.`,
    )
  }
  const unresolved = driverRuns
    .filter(
      (run) =>
        run.fails &&
        (run.state === 'inconclusive' || run.state === 'device-offline'),
    )
    .map((run) =>
      run.state === 'inconclusive'
        ? `In "${run.test}" the driver ended inconclusive: ${run.reason}.`
        : `In "${run.test}" ${run.reason}.`,
    )
  const faulted = driverRuns
    .filter((run) => run.fails && run.state === 'faulted')
    .map((run) => `"${run.test}"`)
  const incomplete = driverRuns
    .filter(
      (run) =>
        run.fails && (run.state === 'driving' || run.state === 'aborted'),
    )
    .map((run) => `"${run.test}"`)
  const withoutDriverCall = leafTests(file.tasks)
    .filter(
      (test) =>
        test.fails &&
        (test.result?.state === 'pass' || test.result?.state === 'fail') &&
        lastDriverRun(test) === undefined,
    )
    .map((test) => `"${test.name}"`)
  const problems = [
    ...unresolved,
    ...(faulted.length > 0
      ? [`The driver ended on a driver fault in ${faulted.join(', ')}.`]
      : []),
    ...(incomplete.length > 0
      ? [
          `The driver never returned a result and cleaned up in ${incomplete.join(', ')}, the test timed out or its cleanup failed.`,
        ]
      : []),
    ...(withoutDriverCall.length > 0
      ? [`No driver call was recorded for ${withoutDriverCall.join(', ')}.`]
      : []),
  ]
  if (problems.length > 0) {
    throw new Error(
      `${problems.join(' ')} These tests are marked \`test.fails\`, which counts any error as the expected failure, so they say nothing about the editor.`,
    )
  }
})

function leafTests(tasks: readonly RunnerTask[]): RunnerTestCase[] {
  return tasks.flatMap((task) =>
    task.type === 'test'
      ? [task]
      : task.type === 'suite'
        ? leafTests(task.tasks)
        : [],
  )
}
