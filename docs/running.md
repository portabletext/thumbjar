# Running tests

The `thumbjar` command prepares a booted emulator and runs device tests on it. It never boots the emulator. Start the emulator yourself first.

## thumbjar fetch-u2-jar

```sh
npx thumbjar fetch-u2-jar
```

Downloads the uiautomator2 server jar that the driver installs on the device. Run it from the package you run Vitest in, so the tests find the cached jar. It needs no device.

The jar goes to `node_modules/.cache/thumbjar/u2.jar` in the nearest directory with a `package.json`. Set `CACHE_DIR` to use `$CACHE_DIR/thumbjar/u2.jar` instead. The command checks the jar's pinned hash and reuses a cached file that matches. It tries three downloads of up to 45 seconds each, 15 seconds apart.

## thumbjar run

```sh
npx thumbjar run tests/ja.test.ts --keyboard ja --page-dir dist --config vitest.config.ts --project device
```

Serves the page, prepares the device, runs one test file and collects diagnostics. It is the usual way to run device tests.

- `<file>` is the test file to run.
- `--keyboard` is `ja` or `en`.
- `--page-dir` is the built page directory. It must contain `editor.html`.
- `--config` is the Vitest config file.
- `--project` is the device project's name.
- `--port` is the port to serve on. It defaults to `8765`.
- `--out-dir` is where output goes. It defaults to `out`.

`run` resolves Vitest from the working directory's package. It reads the test file relative to the page directory's parent to work out the file's time budget, so run it from that directory with the tests next to the page directory.

If preparation fails, `run` exits with `1`. Otherwise it exits with the test stage's status.

## thumbjar serve

```sh
npx thumbjar serve dist --port 8765
```

Serves a directory over HTTP and logs one line per request. `--port` defaults to `8765`. Use it with `prepare` when you run Vitest yourself.

## thumbjar prepare

```sh
npx thumbjar prepare --keyboard ja --page-url http://localhost:8765/editor.html
npx vitest run --project device
```

Prepares a booted emulator for one keyboard. `run` calls it for you.

- `--keyboard` is `ja` or `en`. It is required.
- `--page-url` is the page to check. It is required. A `localhost` port is forwarded to the device.
- `--out-dir` defaults to `out`.
- `--booted` is the host's epoch seconds when the emulator came online. Without it, the time preparation started is used.

Preparation attempts to disable Play Store updates, waits out system error dialogs after boot, sets up Chrome and the soft keyboard and checks the page URL.

For `ja`, it adds Gboard's Japanese QWERTY layout and waits for this boot's dictionary load, at most 360 seconds after `--booted`. It then switches Gboard to Japanese and checks that typing `kyou` offers conversion candidates.

For `en`, it types `hello` and Space into the page so Chrome and Gboard are past their first use. The page URL gets `thumbjar=english-warmup` added, so your page can tell. A page that saves its input will save `Hello`. It tries up to three times and fails if no attempt gives `Hello`, ignoring case. Each attempt is a line in `en-warmup.jsonl` and, on GitHub Actions, in the step summary.

`prepare` exits with these statuses.

- `0` when the device is ready.
- `1` when preparation failed, or when an argument cannot be parsed, such as a flag without a value or an unknown flag.
- `2` when a required flag is missing or a value is invalid.
- `3` when the Japanese dictionary never loaded.
- `130`, `129` or `143` on `SIGINT`, `SIGHUP` or `SIGTERM`.

## thumbjar ci android run

```sh
npx thumbjar ci android run tests/ja.test.ts --keyboard ja --page-dir dist --config vitest.config.ts --project device
```

What the [Android GitHub action](ci.md#the-github-action) runs inside the emulator runner. It is `thumbjar run` with the same flags, defaults and exit statuses.

## thumbjar ci android retry

```sh
npx thumbjar ci android retry --out-dir out
```

Decides, after a failed run in CI, whether to run once more on a fresh emulator. It reads `<out-dir>/timing.txt` and needs no device. `--out-dir` defaults to `out`.

It exits with `0` when the emulator never booted, adb lost the device after boot, or Gboard's Japanese dictionary never loaded on a device that was still reachable. It then appends a `RETRY` line to `timing.txt`, so the retry's lines follow it. It exits with `1` after any other failure, a test failure included, and when `timing.txt` already holds a `RETRY` line. It prints one line saying why.

## Artifacts

`runOnDevice` writes to the project's `outDir`, `out` by default. File names start with the keyboard and the test name in lowercase with dashes, such as `ja-kyou-converts-to.json`. A leading `Scenario: ` is dropped. Retry artifacts add `-retry`.

- `<name>.json` holds the options, step records and result.
- `<name>-keyboard.xml` and a screenshot capture the keyboard after loading.
- `<name>-fail.xml` and a screenshot capture the screen after a failed attempt.

`thumbjar run` also writes these to `--out-dir`.

- `timing.txt` and `phases.log` time each stage.
- `http.log` logs the page server's requests.
- `vitest.log` holds the test output.
- `logcat.txt` holds the device log from the start of the test stage.
- `logcat-crash.txt`, `chrome-exit-info.txt` and `final.png` are collected after the test stage.
- `diagnose.txt` is written by preparation. Japanese preparation adds `ja-setup.log` and `ja-dictionary.log`. English preparation adds `en-warmup.log` and `en-warmup.jsonl`.

After failed preparation or failed tests, `run` checks the device and records the result in `timing.txt`.
