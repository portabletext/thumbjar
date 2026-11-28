# CI on GitHub Actions

Device tests run on GitHub's `ubuntu-latest` runners with an x86_64 Android emulator. thumbjar's own [`.github/workflows/device.yml`](../.github/workflows/device.yml) is a working example. It runs `e2e/` and checks that thumbjar both passes a correct page and catches the planted input bug in `e2e/page/beforeinput.html`.

## The GitHub action

The `portabletext/thumbjar/android` action boots the emulator, runs one device test file on it and uploads the diagnostics. It retries once on a fresh emulator when the first one fails as infrastructure. It needs thumbjar 1.1.0 or later installed in `working-directory`.

Reference the action as `@v1`. The `v1` tag moves to every 1.x release, so it always matches the latest thumbjar 1.x on npm. Pin an exact release tag such as `@v1.1.0` if you want the action to match a locked thumbjar version.

```yaml
jobs:
  android:
    runs-on: ubuntu-latest
    timeout-minutes: 155
    strategy:
      fail-fast: false
      matrix:
        include:
          - {lang: ja, actionMinutes: 134}
          - {lang: en, actionMinutes: 110}
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 24

      - run: npm ci
      - run: npm run build

      - name: Run on emulator
        timeout-minutes: ${{ matrix.actionMinutes }}
        uses: portabletext/thumbjar/android@v1
        with:
          test: tests/${{ matrix.lang }}.test.ts
          keyboard: ${{ matrix.lang }}
```

Run the action after checkout, Node setup, the install that brings in `thumbjar` and the build that writes `editor.html` into the page directory. Swap `npm ci` and `npm run build` for your package manager and page build. It enables KVM, runs `thumbjar fetch-u2-jar`, then runs `thumbjar ci android run` inside [`reactivecircus/android-emulator-runner`](https://github.com/ReactiveCircus/android-emulator-runner) with the same emulator settings as [the manual job](#the-manual-job).

### Inputs

| Input               | Default                                     |                                                                                                 |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `test`              | required                                    | The device test file, relative to `working-directory`.                                          |
| `keyboard`          | required                                    | `ja` or `en`.                                                                                   |
| `working-directory` | `.`                                         | The package that depends on `thumbjar` and holds the Vitest config.                             |
| `page-dir`          | `dist`                                      | The built page directory, a direct child of `working-directory`. It must contain `editor.html`. |
| `config`            | `vitest.config.ts`                          | The Vitest config, relative to `working-directory`.                                             |
| `project`           | `device`                                    | The Vitest project with the device tests.                                                       |
| `out-dir`           | `out`                                       | Where the CLI writes its logs, relative to `working-directory`. It is uploaded as an artifact.  |
| `artifact-name`     | `thumbjar-android-<keyboard>-<run attempt>` | The artifact's name. Give each job its own.                                                     |
| `api-level`         | `36`                                        | The emulator's Android API level.                                                               |
| `emulator-build`    | `16428233`                                  | The emulator build to install.                                                                  |

thumbjar reads the test file relative to the page directory's parent to work out its time budget, so `page-dir` must sit directly in `working-directory`, next to the tests. A nested one such as `build/web` fails before the emulator starts.

`out-dir` only moves the CLI's own logs. The per-test diagnostics go to `deviceProject`'s `outDir`, so if you change one, set the other to match, or those files miss the artifact.

### The retry

When the first run fails, `thumbjar ci android retry` reads `timing.txt` and the action runs once more on a fresh emulator only when one of these happened.

- The emulator never booted.
- adb lost the device after boot.
- Gboard's Japanese dictionary never loaded on a device that was still reachable.

A test failure on a reachable device is never retried, and a retry is never retried. The action fails when its last run failed. Both runs write to the same `out-dir`, and the artifact is uploaded either way.

### The step cap

Composite actions take no `timeout-minutes` of their own, so set it on the step that uses the action. It must cover two runs, the first and the retry, plus the jar fetch and the upload. thumbjar's own workflow budgets 62 minutes per run for `ja` with 3 tests and 50 for `en` with 2, so the step gets 134 and 110 minutes: two runs plus 4 for the jar, 5 for the upload and 1 for the rest. See [time budgets](#time-budgets) for what one run must cover.

## The manual job

To run the emulator yourself, without the action's retry, use the emulator runner directly.

```yaml
jobs:
  android:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    strategy:
      fail-fast: false
      matrix:
        include:
          - {lang: ja, runMinutes: 62}
          - {lang: en, runMinutes: 50}
    steps:
      - uses: actions/checkout@v7

      - name: Enable KVM group perms
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules
          sudo udevadm trigger --name-match=kvm

      - uses: actions/setup-node@v7
        with:
          node-version: 24

      - run: npm ci
      - run: npm run build

      - name: Fetch the uiautomator2 server jar
        timeout-minutes: 4
        run: npx thumbjar fetch-u2-jar

      - name: Run on emulator
        timeout-minutes: ${{ matrix.runMinutes }}
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 36
          target: google_apis_playstore
          arch: x86_64
          emulator-build: 16428233
          profile: pixel_6
          disable-animations: true
          ram-size: 4096M
          cores: 4
          heap-size: 512M
          emulator-options: -no-window -gpu swiftshader_indirect -noaudio -no-boot-anim
          emulator-boot-timeout: 360
          script: npx thumbjar run tests/${{ matrix.lang }}.test.ts --keyboard ${{ matrix.lang }} --page-dir dist --config vitest.config.ts --project device

      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: device-android-${{ matrix.lang }}-${{ github.run_attempt }}
          path: out/
```

The KVM step lets the runner's user open `/dev/kvm`, so the emulator runs with hardware acceleration. Set `runMinutes` to one run's cap, as described below.

`emulator-build: 16428233` pins emulator 37.2.12. Emulator 37.2.13 crashes during guest process cleanup.

The `google_apis_playstore` image comes with Chrome and Gboard. `thumbjar run` serves the page, prepares the device and runs the file inside the runner's `script`, so the emulator stays up for all of it.

Pass `summaryFile: process.env.GITHUB_STEP_SUMMARY` to `deviceProject` to get a table of each file's tests in the job summary. See [vitest.md](vitest.md).

## Time budgets

Every stage of thumbjar has a time bound. Set your step timeouts at or above these bounds, so the CI system never cuts a step off before thumbjar can report why it ended. They are caps, not expected durations.

- One `runOnDevice` call takes at most 636 seconds. The device project's test timeout is 661 seconds. Time spent waiting for earlier calls counts against it.
- `thumbjar prepare` takes at most 889 seconds for `ja` and 822 for `en`.
- `thumbjar fetch-u2-jar` takes at most 165 seconds.
- The emulator runner waits up to 360 seconds for boot with `emulator-boot-timeout: 360`.

These bounds assume adb processes exit after SIGKILL. When one does not, no later typing starts.

`thumbjar/vitest` exports the bounds for your own budgeting.

- `deviceTestFileSeconds(testCount)` is the longest a test file of `testCount` tests runs, including Vitest startup and global setup.
- `prepWorstSeconds(keyboard)` is the longest `thumbjar prepare` runs.
- `FETCH_U2_JAR_WORST_SECONDS` is the longest `thumbjar fetch-u2-jar` runs.
- `countDeviceTests(source)` counts the tests in a test file's source.

`thumbjar run` uses `countDeviceTests` and `deviceTestFileSeconds` to cap the test stage. `countDeviceTests` counts `test(` and `test.fails(` calls at the start of a line. When that does not match what Vitest collects, for example with `test.for` or tests generated in a loop, declare the total, skipped tests included, and keep a collection test that checks the declaration against the count Vitest collects.

```ts
// thumbjar-test-count: 13
```

Each `runMinutes` must cover the runner setup, the boot wait, preparation, the test file and the final diagnostics. In thumbjar's own workflow that is 59 minutes for `ja` with 3 tests and 46 for `en` with 2. Each added test adds up to 661 seconds, so raise them when you add tests.

## Failures and flakes

Assertions never retry, and the device project sets `retry: 0`. The driver retries some faults on its own. See [cases.md](cases.md#retries).

Known sources of flakes are slow emulator boots, dropped Chrome DevTools connections and partial Gboard accessibility dumps. Keep them apart from assertions about your page's text and state.

When a job fails, download the artifact and start with `phases.log` and `timing.txt`. See [running.md](running.md#artifacts) for every file.
