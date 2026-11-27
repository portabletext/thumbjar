# iOS Simulator

`deviceProject({device: 'ios'})` runs the same `runOnDevice` calls in Mobile Safari on the iOS Simulator. The page and `recordInput` need no changes.

```ts
import {deviceProject} from 'thumbjar/vitest'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      deviceProject({
        name: 'ios',
        device: 'ios',
        include: ['tests/*.test.ts'],
        pageUrl: 'http://localhost:8765/editor.html',
        pageHint: 'Build the page into dist and serve it with thumbjar serve.',
      }),
    ],
  },
})
```

## Requirements

- macOS with Xcode and a booted iOS Simulator.
- The optional `webdriverio` peer dependency: `npm install --save-dev webdriverio`.
- An Appium server with the XCUITest driver, listening on `127.0.0.1:4723`.

The `UDID` and `IOS_VERSION` environment variables select the simulator and are passed to Appium as `appium:udid` and `appium:platformVersion`.

The simulator opens the host's `localhost` directly, so serve the page with `thumbjar serve` and no port forwarding is needed. `thumbjar prepare` and `thumbjar run` are Android only.

thumbjar does not set up Xcode, the simulator or Appium for you, and it has no packaged CI workflow for iOS yet.

## What it supports

The iOS backend drives compose steps with lowercase `a` to `z` in `letters`, committed with Space or a required Japanese candidate. On Japanese, a Space commit taps Space and then Return. A missing candidate fails the step.

These skip the whole test before a session opens.

- `enter`, `backspace` and `page` steps.
- Compose steps with `text`.
- `commit: 'none'`.
- Candidates on English. Autocorrect and QuickType never appeared on the iOS Simulator.
- Letters other than lowercase `a` to `z`.

Each call makes one attempt. There are no driver retries on iOS. The test timeout is 1200 seconds, which covers the first WebDriverAgent launch.

## Artifacts

Each call writes `<name>.json` with the options, step records and result, `<name>.xml` with the native view hierarchy and `<name>.png` with a screenshot, under the project's `outDir`.
