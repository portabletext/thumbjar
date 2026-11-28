import {expect, test, vi} from 'vitest'
import {runOnDevice} from '../../driver.ts'

test('Scenario: Two calls', async (context) => {
  vi.useFakeTimers()
  gboardDevice.reset()
  const english = runOnDevice(context, {
    keyboard: 'en',
    url: 'http://localhost:8765/editor.html',
    prefix: 'foo',
    steps: [{type: 'enter'}],
  })
  await vi.runAllTimersAsync()
  expect((await english).text).toEqual('foo\n')
  gboardDevice.reset()
  gboardDevice.keyboard = 'ja'
  const japanese = runOnDevice(context, {
    keyboard: 'ja',
    url: 'http://localhost:8765/editor.html',
    prefix: 'foo',
    steps: [{type: 'enter'}],
  })
  await vi.runAllTimersAsync()
  expect((await japanese).text).toEqual('foo\n')
})

test('Scenario: Two calls retry', async (context) => {
  vi.useFakeTimers()
  gboardDevice.reset()
  gboardDevice.recordEvents = true
  gboardDevice.typedOverrides = ['_']
  gboardDevice.adbAnswers = [
    {
      match: /force-stop/,
      answer: {stdout: '', stderr: 'error: device offline\n', code: 1},
    },
  ]
  const running = runOnDevice(context, {
    keyboard: 'en',
    url: 'http://localhost:8765/editor.html',
    prefix: '',
    steps: [{type: 'compose', text: '-', commit: 'none'}],
  })
  await Promise.allSettled([running, vi.runAllTimersAsync()])
  await running
})

test('Scenario: Caught driver fault', async (context) => {
  vi.useFakeTimers()
  gboardDevice.reset()
  gboardDevice.lostReads = [1, 1]
  const running = runOnDevice(context, {
    keyboard: 'en',
    url: 'http://localhost:8765/editor.html',
    prefix: 'foo',
    steps: [{type: 'enter'}],
  })
  await Promise.allSettled([running, vi.runAllTimersAsync()])
  // The test caught the call's fault and fails on its own, unrelated assertion.
  await running.catch(() => {})
  expect('later').toEqual('unrelated')
})
