#!/usr/bin/env node
// The `thumbjar` command. The library never boots the emulator: run these against one that is booted,
// apart from `fetch-u2-jar` and the `ci android` commands other than `run`, which need no device.

import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {localhostPort} from './device/page-url.ts'

const USAGE = `Usage:
  thumbjar fetch-u2-jar
      Download the uiautomator2 server jar unless the calling package's cache already holds it with its pinned hash,
      and check its hash before the emulator boots.
  thumbjar serve <dir> [--port 8765]
      Serve a built page directory over HTTP, one log line per request.
  thumbjar run <file> --keyboard ja|en --page-dir <dir> --config <vitest config> --project <name> [--port 8765] [--out-dir out]
      Serve the page, prepare a booted device, run one test file under its cap and collect diagnostics.
  thumbjar prepare --keyboard ja|en --page-url <url> [--out-dir out] [--booted <epoch seconds>]
      Prepare a booted emulator: keep Play Store from updating apps, wait out the post-boot ANR storm,
      set up Chrome and Gboard, add the Japanese layout for \`--keyboard ja\` and wait until Gboard has
      loaded its Japanese dictionary, at most 360 seconds after --booted, when the emulator came online,
      or after the prep started without it, check that <url> answers and reverse its port to the device
      when it is on localhost.
  thumbjar ci android run <file> --keyboard ja|en --page-dir <dir> --config <vitest config> --project <name> [--port 8765] [--out-dir out]
      What the Android GitHub action runs inside the emulator runner: \`thumbjar run\` with the same flags.
  thumbjar ci android retry [--out-dir out]
      After a failed \`thumbjar run\` in CI, read <out-dir>/timing.txt and exit 0 when the run should be retried once
      on a fresh emulator: its emulator never booted, adb lost the device, or Gboard's Japanese dictionary never
      loaded. It then appends a \`RETRY\` line, so the retry's lines follow it. Exit 1 after any other failure, a test
      failure included, and after a retry.
  thumbjar ci android sdk-cache-key --api <level>
      Read \`sdkmanager --list\` from stdin and print the \`key\` and \`path\` outputs for caching the system image
      under $ANDROID_HOME, keyed by the revision \`sdkmanager\` would install now. Print nothing when the list has no
      such image or the SDK already holds one, so the action skips the cache.
  thumbjar ci android check-emulator --build <id>
      Exit 1 unless $ANDROID_HOME/emulator/source.properties names emulator build <id>, the one the action pinned.`

const [command, ...rest] = process.argv.slice(2)

if (command === 'fetch-u2-jar') {
  await import('./prepare/fetch-u2-jar.ts')
} else if (command === 'serve') {
  const {values, positionals} = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {port: {type: 'string', default: '8765'}},
  })
  if (positionals.length !== 1) {
    usage()
  }
  process.argv = [process.argv[0]!, 'serve', positionals[0]!, values.port]
  await import('./prepare/serve.ts')
} else if (command === 'run') {
  process.exitCode = await runCommand(rest)
} else if (command === 'prepare') {
  const {values} = parseArgs({
    args: rest,
    options: {
      'keyboard': {type: 'string'},
      'page-url': {type: 'string'},
      'out-dir': {type: 'string', default: 'out'},
      'booted': {type: 'string'},
    },
  })
  if (
    (values.keyboard !== 'ja' && values.keyboard !== 'en') ||
    values['page-url'] === undefined ||
    (values.booted !== undefined && !/^\d+$/.test(values.booted))
  ) {
    usage()
  }
  const {prepare} = await import('./prepare/prepare.ts')
  process.exitCode = await prepare({
    keyboard: values.keyboard,
    pageUrl: values['page-url'],
    port: localhostPort(values['page-url']) ?? '',
    out: resolve(values['out-dir']),
    booted: Number(values.booted ?? Math.floor(Date.now() / 1000)),
  })
} else if (command === 'ci' && rest[0] === 'android' && rest[1] === 'run') {
  process.exitCode = await runCommand(rest.slice(2))
} else if (command === 'ci' && rest[0] === 'android' && rest[1] === 'retry') {
  const {values} = parseArgs({
    args: rest.slice(2),
    options: {'out-dir': {type: 'string', default: 'out'}},
  })
  const {retryAfter} = await import('./run/retry.ts')
  const out = resolve(values['out-dir'])
  // A run whose emulator never booted never started `thumbjar run`, which writes the file.
  const decision = retryAfter(read(join(out, 'timing.txt')))
  if (decision.retry) {
    process.stdout.write(`${decision.line}\n`)
    mkdirSync(out, {recursive: true})
    appendFileSync(join(out, 'timing.txt'), 'RETRY\n')
  } else {
    process.stdout.write(
      'NO_RETRY: the run failed on a reachable device, or was already a retry\n',
    )
    process.exitCode = 1
  }
} else if (
  command === 'ci' &&
  rest[0] === 'android' &&
  rest[1] === 'sdk-cache-key'
) {
  const {values} = parseArgs({
    args: rest.slice(2),
    options: {api: {type: 'string'}},
  })
  const sdk = process.env.ANDROID_HOME
  if (values.api === undefined || !/^\d+$/.test(values.api) || !sdk) {
    usage()
  }
  const {sdkCacheKey, systemImagePath} = await import('./run/sdk-cache.ts')
  const key = sdkCacheKey(
    readFileSync(0, 'utf8'),
    values.api,
    process.env.RUNNER_OS ?? process.platform,
  )
  const path = join(sdk, systemImagePath(values.api))
  if (key === undefined) {
    console.error(
      `SDK_CACHE: \`sdkmanager --list\` lists no ${systemImagePath(values.api)} image, skipping the cache`,
    )
  } else if (existsSync(path)) {
    // A restore would overwrite the image the runner image ships.
    console.error(`SDK_CACHE: the SDK already has ${path}, skipping the cache`)
  } else {
    process.stdout.write(`key=${key}\npath=${path}\n`)
  }
} else if (
  command === 'ci' &&
  rest[0] === 'android' &&
  rest[1] === 'check-emulator'
) {
  const {values} = parseArgs({
    args: rest.slice(2),
    options: {build: {type: 'string'}},
  })
  const sdk = process.env.ANDROID_HOME
  if (values.build === undefined || !/^\d+$/.test(values.build) || !sdk) {
    usage()
  }
  const {emulatorMismatch} = await import('./run/emulator-check.ts')
  const properties = join(sdk, 'emulator', 'source.properties')
  const mismatch = emulatorMismatch(
    existsSync(properties) ? readFileSync(properties, 'utf8') : undefined,
    values.build,
  )
  if (mismatch === undefined) {
    process.stdout.write(
      `EMULATOR_CHECKED: ${properties} names the pinned build ${values.build}\n`,
    )
  } else {
    process.stdout.write(`EMULATOR_NOT_PINNED: ${mismatch}\n`)
    process.exitCode = 1
  }
} else {
  usage()
}

async function runCommand(args: string[]): Promise<number> {
  const {values, positionals} = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'keyboard': {type: 'string'},
      'page-dir': {type: 'string'},
      'config': {type: 'string'},
      'project': {type: 'string'},
      'port': {type: 'string', default: '8765'},
      'out-dir': {type: 'string', default: 'out'},
    },
  })
  if (
    positionals.length !== 1 ||
    (values.keyboard !== 'ja' && values.keyboard !== 'en') ||
    !values['page-dir'] ||
    !values.config ||
    !values.project ||
    !/^\d+$/.test(values.port) ||
    Number(values.port) < 1 ||
    Number(values.port) > 65535
  ) {
    usage()
  }
  const {run} = await import('./run/run.ts')
  return run({
    file: positionals[0]!,
    keyboard: values.keyboard,
    pageDir: resolve(values['page-dir']),
    config: values.config,
    project: values.project,
    port: values.port,
    out: resolve(values['out-dir']),
  })
}

function read(file: string): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

function usage(): never {
  console.error(USAGE)
  process.exit(2)
}
