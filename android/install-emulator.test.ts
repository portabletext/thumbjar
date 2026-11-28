import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import pin from './emulator-pin.json' with {type: 'json'}
import {
  emulatorPin,
  emulatorPlan,
  installEmulator,
  TIMED_STAGES_SECONDS,
} from './install-emulator.mjs'

const url = 'https://example.com/emulator.zip'
const pinnedProperties =
  'Pkg.UserSrc=false\nPkg.Revision=37.2.12\nPkg.Path=emulator\nPkg.Desc=Android Emulator\nPkg.BuildId=16428233'

let directory: string
let sdk: string
let logged: string[]

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'install-emulator-'))
  sdk = join(directory, 'sdk')
  mkdirSync(sdk)
  logged = []
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(directory, {recursive: true, force: true})
})

const log = (line: string) => {
  logged.push(line)
}

/** A zip holding `emulator/` with these files, as the pinned archive does. */
function archive(files: Record<string, string>): Buffer {
  const source = mkdtempSync(join(directory, 'source-'))
  mkdirSync(join(source, 'emulator'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(source, 'emulator', name), content)
  }
  const zip = join(directory, `${Date.now()}-${Math.random()}.zip`)
  const result = spawnSync('zip', ['-qr', zip, '.'], {cwd: source})
  expect(result.status).toEqual(0)
  return readFileSync(zip)
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function pinFor(data: Buffer) {
  return {...pin, url, size: data.length, sha256: sha256(data)}
}

/** Answers each fetch with the next body, recording what each attempt left in staging when the next began. */
function serve(...bodies: Array<Buffer | string>) {
  const fetches: Array<{url: unknown; staged: string[]}> = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      fetches.push({url: input, staged: stagedFiles()})
      const body = bodies[fetches.length - 1]!
      return Promise.resolve(
        new Response(typeof body === 'string' ? body : new Uint8Array(body)),
      )
    }),
  )
  return fetches
}

function stagedFiles(): string[] {
  return readdirSync(sdk)
    .filter((name) => name.startsWith('.thumbjar-emulator-'))
    .flatMap((name) => readdirSync(join(sdk, name)))
}

function sdkEmulator(): Record<string, string> {
  const emulator = join(sdk, 'emulator')
  return existsSync(emulator)
    ? Object.fromEntries(
        readdirSync(emulator).map((name) => [
          name,
          readFileSync(join(emulator, name), 'utf8'),
        ]),
      )
    : {}
}

function latestEmulator() {
  mkdirSync(join(sdk, 'emulator'))
  writeFileSync(join(sdk, 'emulator', 'emulator'), 'latest')
  writeFileSync(join(sdk, 'emulator', 'package.xml'), '<latest/>')
}

describe(installEmulator.name, () => {
  test('replaces the SDK emulator with the verified archive and leaves no staging directory', async () => {
    const data = archive({
      'source.properties': pinnedProperties,
      'emulator': 'pinned',
    })
    latestEmulator()
    const fetches = serve(data)

    await installEmulator({sdk, pinned: pinFor(data), log})

    expect({
      fetches: fetches.map(({url}) => url),
      emulator: sdkEmulator(),
      sdk: readdirSync(sdk),
      logged,
    }).toEqual({
      fetches: [url],
      emulator: {'source.properties': pinnedProperties, 'emulator': 'pinned'},
      sdk: ['emulator'],
      logged: [],
    })
  })

  test('installs into an SDK that has no emulator yet', async () => {
    const data = archive({'source.properties': pinnedProperties})
    serve(data)

    await installEmulator({sdk, pinned: pinFor(data), log})

    expect({emulator: sdkEmulator(), sdk: readdirSync(sdk)}).toEqual({
      emulator: {'source.properties': pinnedProperties},
      sdk: ['emulator'],
    })
  })

  test('stops a body over the pinned size, removes the partial file before the next attempt and leaves the SDK as it was', async () => {
    const data = archive({'source.properties': pinnedProperties})
    const oversized = Buffer.concat([data, Buffer.from('x')])
    latestEmulator()
    const fetches = serve(oversized, oversized, oversized)

    await expect(
      installEmulator({sdk, pinned: pinFor(data), retrySeconds: 0, log}),
    ).rejects.toThrowError(
      `emulator archive is over its pinned size of ${data.length} bytes, stopped at ${oversized.length}`,
    )
    expect({
      staged: fetches.map(({staged}) => staged),
      emulator: sdkEmulator(),
      sdk: readdirSync(sdk),
    }).toEqual({
      staged: [[], [], []],
      emulator: {'emulator': 'latest', 'package.xml': '<latest/>'},
      sdk: ['emulator'],
    })
  })

  test('rejects a body short of the pinned size before unpacking it', async () => {
    const data = archive({'source.properties': pinnedProperties})
    latestEmulator()
    serve(data, data, data)

    await expect(
      installEmulator({
        sdk,
        pinned: {...pinFor(data), size: data.length + 1},
        retrySeconds: 0,
        log,
      }),
    ).rejects.toThrowError(
      `emulator archive size ${data.length} bytes, expected ${data.length + 1}`,
    )
    expect({emulator: sdkEmulator(), sdk: readdirSync(sdk)}).toEqual({
      emulator: {'emulator': 'latest', 'package.xml': '<latest/>'},
      sdk: ['emulator'],
    })
  })

  test('rejects an archive of the pinned size with another sha256 before unpacking it', async () => {
    const data = archive({'source.properties': pinnedProperties})
    const tampered = Buffer.from(data)
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1
    serve(tampered, tampered, tampered)

    await expect(
      installEmulator({sdk, pinned: pinFor(data), retrySeconds: 0, log}),
    ).rejects.toThrowError(
      `emulator archive sha256 ${sha256(tampered)}, expected ${sha256(data)}`,
    )
    expect(readdirSync(sdk)).toEqual([])
  })

  test('retries a failed download and installs the next verified one', async () => {
    const data = archive({'source.properties': pinnedProperties})
    const fetches = serve('truncated', data)

    await installEmulator({sdk, pinned: pinFor(data), retrySeconds: 0, log})

    expect({
      fetches: fetches.length,
      emulator: sdkEmulator(),
      logged,
    }).toEqual({
      fetches: 2,
      emulator: {'source.properties': pinnedProperties},
      logged: [
        `emulator archive download failed (1): Error: emulator archive size 9 bytes, expected ${data.length}, retrying`,
      ],
    })
  })

  test('retries an HTTP error, canceling its body and naming the status and the URL without its query', async () => {
    const data = archive({'source.properties': pinnedProperties})
    const canceled: string[] = []
    function failed(
      status: number,
      statusText: string,
      cancel: () => Promise<void>,
    ) {
      const response = new Response(
        new ReadableStream({
          cancel: () => {
            canceled.push(statusText)
            return cancel()
          },
        }),
        {status, statusText},
      )
      Object.defineProperty(response, 'url', {value: `${url}?token=secret`})
      return response
    }
    const responses = [
      failed(503, 'Service Unavailable', () => Promise.resolve()),
      failed(500, 'Internal Server Error', () =>
        Promise.reject(new Error('cancel failed')),
      ),
      new Response(new Uint8Array(data)),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(responses.shift()!)),
    )

    await installEmulator({sdk, pinned: pinFor(data), retrySeconds: 0, log})

    expect({canceled, logged}).toEqual({
      canceled: ['Service Unavailable', 'Internal Server Error'],
      logged: [
        `emulator archive download failed (1): Error: emulator archive download failed: 503 Service Unavailable from ${url}, retrying`,
        `emulator archive download failed (2): Error: emulator archive download failed: 500 Internal Server Error from ${url}, retrying`,
      ],
    })
  })

  test('rejects a verified archive whose emulator is not the pinned build, leaving the SDK emulator as it was', async () => {
    const data = archive({
      'source.properties': pinnedProperties.replace('16428233', '16740729'),
    })
    latestEmulator()
    serve(data)

    await expect(
      installEmulator({sdk, pinned: pinFor(data), log}),
    ).rejects.toThrowError(
      'the verified emulator archive unpacks build 16740729, not the pinned build 16428233',
    )
    expect({emulator: sdkEmulator(), sdk: readdirSync(sdk)}).toEqual({
      emulator: {'emulator': 'latest', 'package.xml': '<latest/>'},
      sdk: ['emulator'],
    })
  })

  test('restores the previous emulator when moving the new one into place fails', async () => {
    const data = archive({'source.properties': pinnedProperties})
    latestEmulator()
    serve(data)
    const renames: string[] = []
    const rename = (from: string, to: string) => {
      renames.push(`${from.replace(sdk, '$SDK')} -> ${to.replace(sdk, '$SDK')}`)
      if (to === join(sdk, 'emulator') && from.endsWith('emulator')) {
        throw new Error('EXDEV: cross-device link not permitted')
      }
      renameSync(from, to)
    }

    await expect(
      installEmulator({sdk, pinned: pinFor(data), rename, log}),
    ).rejects.toThrowError('EXDEV: cross-device link not permitted')
    expect({
      renames: renames.map((line) =>
        line.replace(/\.thumbjar-emulator-\w+/g, '<staging>'),
      ),
      emulator: sdkEmulator(),
      sdk: readdirSync(sdk),
    }).toEqual({
      renames: [
        '$SDK/emulator -> $SDK/<staging>/previous',
        '$SDK/<staging>/unpacked/emulator -> $SDK/emulator',
        '$SDK/<staging>/previous -> $SDK/emulator',
      ],
      emulator: {'emulator': 'latest', 'package.xml': '<latest/>'},
      sdk: ['emulator'],
    })
  })

  test('keeps the previous emulator in staging and names it when restoring it fails too', async () => {
    const data = archive({'source.properties': pinnedProperties})
    latestEmulator()
    serve(data)
    let calls = 0
    const rename = (from: string, to: string) => {
      calls++
      if (calls > 1) {
        throw new Error(`rename ${calls} failed`)
      }
      renameSync(from, to)
    }

    const error = await installEmulator({
      sdk,
      pinned: pinFor(data),
      rename,
      log,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    const [staging] = readdirSync(sdk)
    expect({
      message: (error as Error).message,
      sdk: readdirSync(sdk).length,
      previous: readdirSync(join(sdk, staging!, 'previous')),
    }).toEqual({
      message: `moving the pinned emulator into ${join(sdk, 'emulator')} failed (Error: rename 2 failed), and so did restoring the previous one, which is still at ${join(sdk, staging!, 'previous')}`,
      sdk: 1,
      previous: ['emulator', 'package.xml'],
    })
  })

  test('downloads from the URL and checks the size and hash that `emulator-pin.json` pins', async () => {
    const fetches = serve('foo', 'foo', 'foo')

    await expect(
      installEmulator({sdk, retrySeconds: 0, log}),
    ).rejects.toThrowError(
      `emulator archive size 3 bytes, expected ${pin.size}`,
    )
    expect(fetches.map(({url}) => url)).toEqual([pin.url, pin.url, pin.url])
  })
})

describe(emulatorPlan.name, () => {
  test('installs the pinned build itself and gives the runner no build', () => {
    expect(emulatorPlan('16428233')).toEqual({
      install: true,
      runnerBuild: '',
      pinnedBuild: '16428233',
    })
  })

  test('passes another build to the runner unverified, with a warning', () => {
    expect(emulatorPlan('16740729')).toEqual({
      install: false,
      runnerBuild: '16740729',
      pinnedBuild: '',
      warning:
        "emulator-build 16740729 is not thumbjar's pinned build, so the emulator runner downloads and unpacks it unverified. Set it to 16428233, thumbjar's pinned emulator 37.2.12, to have its archive's size and SHA-256 checked.",
    })
  })

  test("leaves an empty build to the runner's SDK emulator, with a warning", () => {
    expect(emulatorPlan('')).toEqual({
      install: false,
      runnerBuild: '',
      pinnedBuild: '',
      warning:
        "emulator-build is empty, so the emulator runner launches the SDK's emulator, which thumbjar does not verify. Set it to 16428233, thumbjar's pinned emulator 37.2.12, to have its archive's size and SHA-256 checked.",
    })
  })

  test('rejects a build that is not digits', () => {
    expect(() => emulatorPlan('1642; rm -rf /')).toThrowError(
      'emulator-build must be an emulator build ID, digits only, or empty, not "1642; rm -rf /"',
    )
  })
})

describe('install-emulator.mjs', () => {
  const script = join(import.meta.dirname, 'install-emulator.mjs')

  function runScript(build: string) {
    const outputs = join(directory, 'outputs')
    writeFileSync(outputs, '')
    const result = spawnSync(process.execPath, [script], {
      env: {
        PATH: process.env.PATH,
        ANDROID_HOME: sdk,
        GITHUB_OUTPUT: outputs,
        EMULATOR_BUILD: build,
      },
      encoding: 'utf8',
    })
    return {
      status: result.status,
      stdout: result.stdout,
      outputs: readFileSync(outputs, 'utf8'),
    }
  }

  test('hands another build to the runner with a warning and installs nothing', () => {
    expect({...runScript('16740729'), sdk: readdirSync(sdk)}).toEqual({
      status: 0,
      stdout: `::warning::${(emulatorPlan('16740729') as {warning: string}).warning}\n`,
      outputs: 'build=16740729\nrunner-build=16740729\npinned-build=\n',
      sdk: [],
    })
  })

  test('trims the build as the runner does', () => {
    expect([runScript('  16740729 \n'), runScript(' \t ')]).toEqual([
      {
        status: 0,
        stdout: `::warning::${(emulatorPlan('16740729') as {warning: string}).warning}\n`,
        outputs: 'build=16740729\nrunner-build=16740729\npinned-build=\n',
      },
      {
        status: 0,
        stdout: `::warning::${(emulatorPlan('') as {warning: string}).warning}\n`,
        outputs: 'build=\nrunner-build=\npinned-build=\n',
      },
    ])
  })

  test('fails on a build that is not digits, writing no outputs', () => {
    expect(runScript(' 1642 8233 ')).toEqual({
      status: 1,
      stdout:
        '::error::Error: emulator-build must be an emulator build ID, digits only, or empty, not "1642 8233"\n',
      outputs: '',
    })
  })
})

test('`emulator-pin.json` pins emulator 37.2.12 from dl.google.com with its size and sha256', () => {
  expect(emulatorPin).toEqual({
    version: '37.2.12',
    build: '16428233',
    url: 'https://dl.google.com/android/repository/emulator-linux_x64-16428233.zip',
    size: 349654171,
    sha256: 'b08fc43d8608d2955f607f1b287beb525041e730086bdca3af152accac3af9c1',
  })
})

test("the install's timed stages take at most 510 seconds: three downloads of 120, 15 apart, and an unpack of 120", () => {
  expect(TIMED_STAGES_SECONDS).toEqual(510)
})
