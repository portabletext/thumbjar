import {runOnDevice} from 'thumbjar'
import {expect, test} from 'vitest'

test('Scenario: Typing kyou twice into an empty field', async (context) => {
  const run = await runOnDevice(context, {
    keyboard: 'en',
    url: 'http://localhost:8765/editor.html',
    prefix: '',
    steps: [
      {type: 'compose', letters: 'kyou', commit: 'space'},
      {type: 'compose', letters: 'kyou', commit: 'space'},
    ],
  })

  // Chrome ends a plain `contenteditable` with a non-breaking space, and sometimes drops it.
  expect(run.text).toBeOneOf(['Kyou kyou ', 'Kyou kyou ', 'Kyou kyou'])
})

test('Scenario: Typing kyou twice after existing text', async (context) => {
  const run = await runOnDevice(context, {
    keyboard: 'en',
    url: 'http://localhost:8765/editor.html',
    prefix: 'x',
    steps: [
      {type: 'compose', letters: 'kyou', commit: 'space'},
      {type: 'compose', letters: 'kyou', commit: 'space'},
    ],
  })

  expect(run.text).toBeOneOf(['xkyou kyou ', 'xkyou kyou ', 'xkyou kyou'])
})
