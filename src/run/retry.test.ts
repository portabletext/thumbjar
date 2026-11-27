import {describe, expect, test} from 'vitest'
import {retryAfter} from './retry.ts'

describe(retryAfter.name, () => {
  test('retries a run whose emulator never booted, which left no timing at all', () => {
    expect(retryAfter('')).toEqual({
      retry: true,
      line: 'BOOT_RETRY: the emulator never booted, retrying once on a fresh emulator',
    })
  })

  test('retries a run whose device adb lost after boot', () => {
    expect(
      retryAfter('BOOTED at 160\nPREP FAILED: setup\nCHECKED lost at 400\n'),
    ).toEqual({
      retry: true,
      line: 'DEVICE_LOST_RETRY: adb lost the device after boot, retrying once on a fresh emulator',
    })
  })

  test('retries a run whose Japanese dictionary never loaded on a device the check found reachable', () => {
    expect(
      retryAfter(
        'BOOTED at 160\nPREP FAILED: dictionary\nPREP DICTIONARY_NOT_LOADED\nCHECKED device at 600\n',
      ),
    ).toEqual({
      retry: true,
      line: "DICTIONARY_RETRY: Gboard's Japanese dictionary never loaded, retrying once on a fresh emulator",
    })
  })

  test('never retries a test failure on a reachable device', () => {
    expect(
      retryAfter('BOOTED at 160\nCHECKED device at 900\nDONE at 960\n'),
    ).toEqual({retry: false})
  })

  test('never retries a run that needed no device check', () => {
    expect(
      retryAfter('BOOTED at 160\nCHECKED skipped at 900\nDONE at 960\n'),
    ).toEqual({retry: false})
  })

  test('never retries a booted run that ended before the device check reached a verdict', () => {
    expect(retryAfter('BOOTED at 160\nPREP FAILED: setup\n')).toEqual({
      retry: false,
    })
  })

  test('retries as a lost device a dictionary failure after which adb lost the device', () => {
    expect(
      retryAfter(
        'BOOTED at 160\nPREP DICTIONARY_NOT_LOADED\nCHECKED lost at 600\n',
      ),
    ).toEqual({
      retry: true,
      line: 'DEVICE_LOST_RETRY: adb lost the device after boot, retrying once on a fresh emulator',
    })
  })

  test('never retries a retry, whatever it ended with', () => {
    expect([
      retryAfter('RETRY\n'),
      retryAfter('BOOTED at 160\nCHECKED lost at 400\nRETRY\n'),
      retryAfter(
        'RETRY\nBOOTED at 900\nPREP DICTIONARY_NOT_LOADED\nCHECKED device at 1300\n',
      ),
    ]).toEqual([{retry: false}, {retry: false}, {retry: false}])
  })
})
