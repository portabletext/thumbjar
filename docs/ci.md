# CI on GitHub Actions

Device tests run on GitHub's `ubuntu-latest` runners with an x86_64 Android emulator. thumbjar's own [`.github/workflows/device.yml`](../.github/workflows/device.yml) is a working example. It runs `e2e/` and checks that thumbjar both passes a correct page and catches the planted input bug in `e2e/page/beforeinput.html`.

## The job

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

The KVM step lets the runner's user open `/dev/kvm`, so the emulator runs with hardware acceleration.

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
