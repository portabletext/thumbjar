import {describe, expect, test} from 'vitest'
import {emulatorMismatch} from './emulator-check.ts'

// The fields of `emulator/source.properties` after the emulator runner unpacked build 16428233 over the latest emulator.
const pinned = 'Pkg.UserSrc=false\nPkg.Revision=37.2.12\nPkg.BuildId=16428233\n'

describe(emulatorMismatch.name, () => {
  test('accepts the pinned build', () => {
    expect(emulatorMismatch(pinned, '16428233')).toEqual(undefined)
  })

  test('accepts spaces around the build', () => {
    expect(
      emulatorMismatch(
        'Pkg.Revision = 37.2.12\nPkg.BuildId = 16428233 \n',
        '16428233',
      ),
    ).toEqual(undefined)
  })

  test('names the build and version it found instead of the pin', () => {
    expect(
      emulatorMismatch(
        pinned.replace('37.2.12', '37.2.13').replace('16428233', '16740729'),
        '16428233',
      ),
    ).toEqual(
      'the emulator is build 16740729 (version 37.2.13), not the pinned build 16428233',
    )
  })

  test('names a build found without a version', () => {
    expect(emulatorMismatch('Pkg.BuildId=16740729\n', '16428233')).toEqual(
      'the emulator is build 16740729, not the pinned build 16428233',
    )
  })

  test('rejects properties that name no build, even with the pinned version', () => {
    expect([
      emulatorMismatch('Pkg.Revision=37.2.12\n', '16428233'),
      emulatorMismatch('Pkg.BuildId=\n', '16428233'),
      emulatorMismatch('', '16428233'),
    ]).toEqual([
      'emulator/source.properties names no build',
      'emulator/source.properties names no build',
      'emulator/source.properties names no build',
    ])
  })

  test('rejects an SDK without the properties file', () => {
    expect(emulatorMismatch(undefined, '16428233')).toEqual(
      'the SDK has no emulator/source.properties',
    )
  })

  test('never matches a build that only starts with the pin', () => {
    expect(emulatorMismatch('Pkg.BuildId=164282330\n', '16428233')).toEqual(
      'the emulator is build 164282330, not the pinned build 16428233',
    )
  })
})
