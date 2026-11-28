// The Android action's emulator step, run as `node "$GITHUB_ACTION_PATH/install-emulator.mjs"` before the emulator
// runner. It needs nothing from the installed thumbjar package, so an action from the moving `v1` tag works with
// any thumbjar 1.x that a project has locked. `emulator-pin.json` beside it pins the emulator archive's URL, size
// and SHA-256.
//
// `EMULATOR_BUILD` is the action's `emulator-build` input. When it is the pinned build, the archive is streamed to a
// private file, unpacked only once its size and SHA-256 match the pin, and swapped in for `$ANDROID_HOME/emulator`;
// the runner then gets no `emulator-build`. Any other build, or none, goes to the runner as before, unchecked, with
// a warning. The step writes `build`, the trimmed input, `runner-build`, the runner's `emulator-build`, and `pinned-build`, set only when the
// pinned build was installed, to `$GITHUB_OUTPUT`.

import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import {join} from 'node:path'
import {Readable, Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {setTimeout as sleep} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'

/**
 * @typedef {{version: string, build: string, url: string, size: number, sha256: string}} EmulatorPin
 */

/** @type {EmulatorPin} */
export const emulatorPin = JSON.parse(
  readFileSync(new URL('emulator-pin.json', import.meta.url), 'utf8'),
)

/** One download of the 350 MB archive, its body included. portabletext/editor's install gave curl 120 seconds. */
const ARCHIVE_ATTEMPT_SECONDS = 120

/** The downloads tried before the step fails. */
const ARCHIVE_ATTEMPTS = 3

/** The wait before the next download. */
const ARCHIVE_RETRY_SECONDS = 15

/** Unpacking the verified archive, 860 MB unpacked. It took 9 seconds locally. */
const UNPACK_SECONDS = 120

/**
 * The budget of the step's timed stages: every download times out, with the waits between them, then the unpack
 * runs to its bound. Hashing runs inside each download's bound. Creating the staging directory, reading the unpacked
 * `source.properties`, the swap and the cleanup have no bound of their own and are not counted.
 */
export const TIMED_STAGES_SECONDS =
  ARCHIVE_ATTEMPTS * ARCHIVE_ATTEMPT_SECONDS +
  (ARCHIVE_ATTEMPTS - 1) * ARCHIVE_RETRY_SECONDS +
  UNPACK_SECONDS

/**
 * What the step does with `build`, the `emulator-build` input: install the pin, or hand `build` to the runner
 * unchecked with a warning. Throws unless `build` is digits or empty.
 *
 * @param {string} build
 * @param {EmulatorPin} [pinned]
 * @returns {{install: true, runnerBuild: '', pinnedBuild: string} | {install: false, runnerBuild: string, pinnedBuild: '', warning: string}}
 */
export function emulatorPlan(build, pinned = emulatorPin) {
  if (!/^\d*$/.test(build)) {
    throw new Error(
      `emulator-build must be an emulator build ID, digits only, or empty, not ${JSON.stringify(build)}`,
    )
  }
  if (build === pinned.build) {
    return {install: true, runnerBuild: '', pinnedBuild: pinned.build}
  }
  return {
    install: false,
    runnerBuild: build,
    pinnedBuild: '',
    warning:
      build === ''
        ? `emulator-build is empty, so the emulator runner launches the SDK's emulator, which thumbjar does not verify. Set it to ${pinned.build}, thumbjar's pinned emulator ${pinned.version}, to have its archive's size and SHA-256 checked.`
        : `emulator-build ${build} is not thumbjar's pinned build, so the emulator runner downloads and unpacks it unverified. Set it to ${pinned.build}, thumbjar's pinned emulator ${pinned.version}, to have its archive's size and SHA-256 checked.`,
  }
}

/**
 * Download the pinned archive, check its size and SHA-256, unpack it next to `$ANDROID_HOME/emulator` and only then
 * swap it in. A failure that throws restores the SDK's emulator as it was, or names where it is kept when restoring
 * fails too. A hard kill between the swap's two renames can leave `$ANDROID_HOME/emulator` missing and the old
 * emulator at `previous` in a `.thumbjar-emulator-` directory in `$ANDROID_HOME`, which no later run looks at. Assumes
 * one writer per SDK: nothing serializes two installs into the same SDK.
 *
 * @param {object} options
 * @param {string} options.sdk `$ANDROID_HOME`.
 * @param {EmulatorPin} [options.pinned]
 * @param {number} [options.retrySeconds]
 * @param {(from: string, to: string) => void} [options.rename] Moves directories in the swap.
 * @param {(line: string) => void} [options.log]
 */
export async function installEmulator({
  sdk,
  pinned = emulatorPin,
  retrySeconds = ARCHIVE_RETRY_SECONDS,
  rename = renameSync,
  log = (line) => process.stdout.write(`${line}\n`),
}) {
  // On the SDK's filesystem, so the swap is two renames. `sdkmanager` skips directories that start with a dot.
  // `mkdtemp` makes it readable by its owner only.
  const staging = mkdtempSync(join(sdk, '.thumbjar-emulator-'))
  let keepStaging = false
  try {
    const archive = join(staging, 'emulator.zip')
    for (let attempt = 1; ; attempt++) {
      try {
        await download({url: pinned.url, file: archive, pinned})
        break
      } catch (error) {
        rmSync(archive, {force: true})
        if (attempt >= ARCHIVE_ATTEMPTS) {
          throw error
        }
        log(
          `emulator archive download failed (${attempt}): ${describe(error)}, retrying`,
        )
        await sleep(retrySeconds * 1000)
      }
    }

    const unpacked = join(staging, 'unpacked')
    const unzip = spawnSync('unzip', ['-q', archive, '-d', unpacked], {
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: UNPACK_SECONDS * 1000,
      killSignal: 'SIGKILL',
    })
    if (unzip.status !== 0) {
      throw new Error(
        `unzip of the verified emulator archive failed: ${unzip.error?.message ?? `status ${unzip.status}, signal ${unzip.signal}`}`,
      )
    }
    rmSync(archive)
    const staged = join(unpacked, 'emulator')
    const found = buildId(join(staged, 'source.properties'))
    if (found !== pinned.build) {
      throw new Error(
        `the verified emulator archive unpacks build ${found ?? '(none)'}, not the pinned build ${pinned.build}`,
      )
    }

    // The old emulator moves aside, not away, until the new one is in place, so a failed swap can put it back.
    const emulator = join(sdk, 'emulator')
    const backup = join(staging, 'previous')
    const hadEmulator = existsSync(emulator)
    if (hadEmulator) {
      rename(emulator, backup)
    }
    try {
      rename(staged, emulator)
    } catch (error) {
      if (hadEmulator) {
        try {
          rename(backup, emulator)
        } catch (restoreError) {
          keepStaging = true
          throw new Error(
            `moving the pinned emulator into ${emulator} failed (${describe(error)}), and so did restoring the previous one, which is still at ${backup}`,
            {cause: restoreError},
          )
        }
      }
      throw error
    }
  } finally {
    if (!keepStaging) {
      rmSync(staging, {recursive: true, force: true})
    }
  }
}

/**
 * Stream `url` into `file`, a new file only its owner can read, counting and hashing on the way. Stops as soon as
 * the body passes the pinned size, and throws unless the size and SHA-256 match the pin exactly.
 *
 * @param {{url: string, file: string, pinned: EmulatorPin}} options
 */
async function download({url, file, pinned}) {
  const signal = AbortSignal.timeout(ARCHIVE_ATTEMPT_SECONDS * 1000)
  const response = await fetch(url, {signal})
  if (!response.ok || response.body === null) {
    const error = new Error(
      `emulator archive download failed: ${response.status} ${response.statusText} from ${answeringUrl(response)}`,
    )
    // Frees the connection before the next attempt. The status is the error to report, so a failed cancel is dropped.
    await response.body?.cancel().catch(() => {})
    throw error
  }
  const hash = createHash('sha256')
  let size = 0
  const count = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > pinned.size) {
        callback(
          new Error(
            `emulator archive is over its pinned size of ${pinned.size} bytes, stopped at ${size}`,
          ),
        )
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(
    // @ts-expect-error Node's web stream types differ from the DOM ones `fetch` is typed with.
    Readable.fromWeb(response.body),
    count,
    createWriteStream(file, {flags: 'wx', mode: 0o600}),
    {signal},
  )
  if (size !== pinned.size) {
    throw new Error(
      `emulator archive size ${size} bytes, expected ${pinned.size}`,
    )
  }
  const digest = hash.digest('hex')
  if (digest !== pinned.sha256) {
    throw new Error(
      `emulator archive sha256 ${digest}, expected ${pinned.sha256}`,
    )
  }
}

/**
 * The `Pkg.BuildId` in `properties`, or `undefined` when the file or the field is missing.
 *
 * @param {string} properties
 */
function buildId(properties) {
  if (!existsSync(properties)) {
    return undefined
  }
  return /^Pkg\.BuildId\s*=\s*(.*)$/m
    .exec(readFileSync(properties, 'utf8'))?.[1]
    ?.trim()
}

/**
 * The URL that answered, after redirects, without its query.
 *
 * @param {Response} response
 */
function answeringUrl(response) {
  if (response.url === '') {
    return '(no URL)'
  }
  const url = new URL(response.url)
  return `${url.origin}${url.pathname}`
}

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

async function main() {
  const sdk = process.env.ANDROID_HOME
  const outputs = process.env.GITHUB_OUTPUT
  if (!sdk || !outputs) {
    throw new Error('ANDROID_HOME and GITHUB_OUTPUT must be set')
  }
  // Trimmed as the runner's `core.getInput` trims its inputs.
  const build = (process.env.EMULATOR_BUILD ?? '').trim()
  const plan = emulatorPlan(build)
  if (plan.install) {
    await installEmulator({sdk})
    process.stdout.write(
      `EMULATOR_INSTALLED: emulator ${emulatorPin.version} build ${emulatorPin.build} in ${join(sdk, 'emulator')}, its archive's size and sha256 checked\n`,
    )
  } else {
    process.stdout.write(`::warning::${plan.warning}\n`)
  }
  appendFileSync(
    outputs,
    `build=${build}\nrunner-build=${plan.runnerBuild}\npinned-build=${plan.pinnedBuild}\n`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    process.stdout.write(`::error::${describe(error)}\n`)
    process.exitCode = 1
  }
}
