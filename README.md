<img src="assets/logo-64.svg" alt="thumbjar" width="64" height="64">

# thumbjar

> Test rich text editors against a real Android or iOS keyboard.

Write a Vitest test that types on a real phone keyboard into your page and get back what your editor ended up with. thumbjar taps Gboard keys in an Android emulator, or the iOS keyboard in the iOS Simulator, and returns the text, the selection and every input and composition event to your test.

Rich text editors break on mobile keyboards in ways desktop tests never see. Gboard composes words, offers conversion candidates and reacts when the page changes the DOM in the middle of a composition. Synthetic events from Playwright or jsdom don't do any of that. thumbjar lets you catch those bugs in a test instead of by hand.

## Install

```sh
npm install --save-dev thumbjar vitest
```

You need Node 24 or later, the Android SDK with `adb` and `emulator` on your `PATH`, and an API 36 Play Store emulator with Chrome and Gboard. See [docs/host.md](docs/host.md) for host setup.

## A first test

In the page under test, record what happens in the field. Bundle this into the page you serve.

```ts
import {recordInput} from 'thumbjar/page'

const field = document.querySelector<HTMLElement>('[contenteditable]')!
field.textContent = new URL(location.href).searchParams.get('prefix') ?? ''

recordInput({field, getText: () => field.textContent})
```

Add a device project to your Vitest config.

```ts
import {deviceProject} from 'thumbjar/vitest'
import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      deviceProject({
        include: ['tests/*.test.ts'],
        pageUrl: 'http://localhost:8765/editor.html',
        pageHint: 'Build the page into dist first.',
      }),
    ],
  },
})
```

Write a test in `tests/ja.test.ts`.

```ts
import {runOnDevice} from 'thumbjar'
import {expect, test} from 'vitest'

test('kyou converts to 今日', async (context) => {
  const run = await runOnDevice(context, {
    url: 'http://localhost:8765/editor.html',
    keyboard: 'ja',
    prefix: '',
    steps: [{type: 'compose', letters: 'kyou', commit: {candidate: '今日'}}],
  })

  expect(run.text).toEqual('今日')
})
```

Build the page as `dist/editor.html`: `thumbjar run` always prepares the device against `/editor.html`. Fetch the uiautomator2 server jar once, boot the emulator, then serve `dist`, prepare the device and run the file in one command.

```sh
npx thumbjar fetch-u2-jar
npx thumbjar run tests/ja.test.ts --keyboard ja --page-dir dist --config vitest.config.ts --project device
```

## Docs

- [Setting up the page](docs/page.md): `recordInput`, the field and what gets recorded.
- [Configuring Vitest](docs/vitest.md): `deviceProject`, global setup and the setup file.
- [Writing cases](docs/cases.md): `runOnDevice`, steps, `Run` and `StepRecord`, retries.
- [Running tests](docs/running.md): the `thumbjar` command and the artifacts it writes.
- [CI on GitHub Actions](docs/ci.md): the emulator job, time budgets and flakes.
- [iOS Simulator](docs/ios.md): the Appium backend and what it supports.
- [Host setup](docs/host.md): Linux, macOS and the emulator image.

## License

MIT
