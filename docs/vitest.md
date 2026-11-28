# Configuring Vitest

`deviceProject` from `thumbjar/vitest` returns a Vitest project for device tests. Add it to `test.projects`.

```ts
import {deviceProject} from 'thumbjar/vitest'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      deviceProject({
        include: ['tests/*.test.ts'],
        pageUrl: 'http://localhost:8765/editor.html',
        pageHint: 'Build the page into dist and serve it with thumbjar serve.',
        summaryFile: process.env.GITHUB_STEP_SUMMARY,
      }),
    ],
  },
})
```

## Options

- `include` lists the device test files.
- `pageUrl` is a page that global setup fetches before any test runs.
- `pageHint` is printed when that fetch fails. Say how to build and serve the page.
- `name` is the project's name. It defaults to `device`.
- `device` is `'android'` or `'ios'`. It defaults to `'android'`. See [ios.md](ios.md).
- `outDir` is where `runOnDevice` writes artifacts, relative to the working directory. It defaults to `out`.
- `summaryFile` is a file that each test file's outcome counts and a table of its tests are appended to. Nothing is written without it.
- `setupFiles` adds your own setup files. They run after thumbjar's.

## What the project sets

The project uses the Node environment and runs one file at a time. It sets `retry: 0`, because a failed assertion is a result about your page. On Android the driver retries some of its own faults. See [cases.md](cases.md#retries). On Android the test and hook timeouts are 661 seconds, which covers the worst case of one `runOnDevice` call. On iOS they are 1200 seconds.

## Global setup

Before any test runs, global setup checks two things.

- On Android, `adb get-state` must report a device. On iOS, the `webdriverio` package must resolve and an Appium server must answer on port 4723.
- `pageUrl` must answer with HTTP 200.

If either check fails, the run fails at once with a message instead of failing in every test. The setup is the default export of `thumbjar/vitest/global-setup`. `deviceProject` wires it up for you.

## The setup file

thumbjar's setup file, `thumbjar/vitest/setup`, runs after each test file. It fails the file in these cases.

- An adb process outlived SIGKILL. It may have touched the device during later tests.
- The page threw while the driver typed.
- A `test.fails` test made no driver call, or its call ended on a driver fault, inconclusive, with the device offline, or without finishing.

The last rule exists because `test.fails` counts any error as the expected failure. An infrastructure error would otherwise pass as a page bug.

For a failed test, the setup file prints the keys the driver tapped and the events each step recorded. It writes the run's [verdict.json](running.md#verdictjson). With `summaryFile` it also appends the file's summary.
