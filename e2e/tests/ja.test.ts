import {runOnDevice, type Run} from 'thumbjar'
import {expect, test} from 'vitest'

/** How many times a composition started while another was still open. */
function nestedCompositions(run: Run): number {
  let nested = 0
  let open = false
  for (const event of run.events) {
    if (event.type === 'compositionstart') {
      if (open) {
        nested += 1
      }
      open = true
    } else if (event.type === 'compositionend') {
      open = false
    }
  }
  return nested
}

function compositionstartPerStep(run: Run): number[] {
  return run.steps.map(
    (step) =>
      step.events.filter((event) => event.type === 'compositionstart').length,
  )
}

test('Scenario: Converting kyou to 今日 twice', async (context) => {
  const run = await runOnDevice(context, {
    keyboard: 'ja',
    url: 'http://localhost:8765/editor.html',
    prefix: '',
    steps: [
      {type: 'compose', letters: 'kyou', commit: {candidate: '今日'}},
      {type: 'compose', letters: 'kyou', commit: {candidate: '今日'}},
    ],
  })

  expect({
    text: run.text,
    nested: nestedCompositions(run),
    compositionstartPerStep: compositionstartPerStep(run),
  }).toEqual({text: '今日今日', nested: 0, compositionstartPerStep: [1, 1]})
})

test('Scenario: Composing kyou', async (context) => {
  const run = await runOnDevice(context, {
    keyboard: 'ja',
    url: 'http://localhost:8765/editor.html',
    prefix: '',
    steps: [{type: 'compose', letters: 'kyou', commit: 'none'}],
  })

  expect({
    text: run.text,
    nested: nestedCompositions(run),
    compositionstartPerStep: compositionstartPerStep(run),
  }).toEqual({text: 'きょう', nested: 0, compositionstartPerStep: [1]})
})

// The planted bug: `beforeinput.html` appends every `beforeinput` `data` to its own text,
// which drifts from what Gboard composes. The composition is left open, so no candidate is required and
// the call cannot end on a missing one: only the assertion can fail, which `test.fails` expects.
test.fails('Scenario: Composing kyou in a field that handles input in beforeinput', async (context) => {
  const run = await runOnDevice(context, {
    keyboard: 'ja',
    url: 'http://localhost:8765/beforeinput.html',
    prefix: '',
    steps: [{type: 'compose', letters: 'kyou', commit: 'none'}],
  })

  expect({
    text: run.text,
    nested: nestedCompositions(run),
    compositionstartPerStep: compositionstartPerStep(run),
  }).toEqual({text: 'きょう', nested: 0, compositionstartPerStep: [1]})
})
