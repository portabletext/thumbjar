# Writing cases

A case is one `runOnDevice` call. It opens your page, runs a list of steps on the keyboard and returns what the page recorded.

```ts
import {runOnDevice} from 'thumbjar'
import {expect, test} from 'vitest'

test('compose and clear', async (context) => {
  const run = await runOnDevice(context, {
    url: 'http://localhost:8765/editor.html',
    keyboard: 'ja',
    prefix: '',
    steps: [
      {type: 'compose', letters: 'kyou', commit: 'none'},
      {type: 'enter'},
      {type: 'page', action: 'clear'},
    ],
  })

  expect(run.steps.map((step) => step.status)).toEqual(['done', 'done', 'done'])
  expect(run.text).toEqual('')
})
```

## runOnDevice

`runOnDevice(context, options)` takes the Vitest context of the test that calls it. That test owns the call's timeout, skip and artifact names. For parameterized tests use `test.for`, which passes the context. `test.each` does not.

The options are these.

- `url` is the page to open. A `localhost` port is forwarded to the device with `adb reverse`.
- `keyboard` is `'ja'` for Gboard's Japanese QWERTY layout or `'en'` for English.
- `prefix` is the text the field holds before the first step. Use `''` for an empty field. See [page.md](page.md#the-prefix).
- `steps` is the list of steps.

Calls drive the device one at a time, in the order they were made. Time spent waiting for earlier calls counts against the calling test's timeout.

## Steps

- `{type: 'compose', letters, commit?}` taps letter keys. `letters` names keys by their lowercase letter `a` to `z`, on either layout. Gboard decides whether a key types a capital. On Japanese, pass romaji such as `kyou`.
- `{type: 'compose', text, commit?}` types text. On English it drives `a` to `z`, `-` and space. On Japanese it drives only `-` and space.
- `{type: 'enter'}` taps the action key.
- `{type: 'backspace', times?}` taps Delete, once by default.
- `{type: 'page', action, args?}` awaits a page action.

A compose step's `commit` says how it ends.

- `'space'` taps Space. This is the default.
- `'none'` leaves the composition open for the next step.
- `{candidate: '今日'}` taps that conversion candidate. The step fails if Gboard does not offer it.

Before touching the device, `runOnDevice` checks that it can drive every step. If it cannot, it skips the test with a note naming each step and why. A case never runs halfway.

## Page steps

A page step awaits the handler registered under `action` in `recordInput({actions})`. `args` is any JSON value. A step without `args` passes `null`.

An unknown action or a handler that throws is a page exception. It is never retried, and the setup file fails the test file. Cases with page steps skip the check for unexpected digits in the final text, since an action may put any text in the field.

## Run

`runOnDevice` returns a `Run`.

- `text` is the page's text after the last step.
- `selection` is the selection after the last step, or `null` outside the field.
- `state` is the `getState` value after the last step, when the page passes `getState`.
- `events` holds every event from the first step on.
- `steps` holds one `StepRecord` per step.

## StepRecord

- `type` is the step's type.
- `status` is `'done'`, `'failed'` or `'skipped'`.
- `reason` says why a step is not `'done'`.
- `textAfter`, `selectionAfter` and `focusedAfter` describe the field after the step.
- `stateAfter` is the `getState` value after the step.
- `events` holds the events the page recorded during the step.
- `keys` lists the keys the driver tapped, in order.

## Boundaries

The driver reads the page at boundaries. Each boundary reads the text, state, selection, focus and event count in one page evaluation. The first boundary comes after the field is focused. Each later boundary comes after a step.

A step's `events` are the events between the boundary before it and the boundary after it. Events from loading the page or focusing the field are in no step.

Driver selections in `Run` and `StepRecord` count grapheme clusters. Event selections from `recordInput` count UTF-16 offsets.

## Failed steps

A step that throws ends the attempt. Later steps are `'skipped'`. The driver reads the page once more for the failed step's text, selection and focus. Values it cannot read stay `null`.

When a step of the final attempt threw, `runOnDevice` rejects with an error that lists each step's position, type, status, reason and `textAfter`. Its `cause` is the value the step threw.

## Retries

Assertions never retry. Only driver faults do, and only in these cases.

- A fault before any keyboard input is retried once. The driver first stops Chrome and checks it restarted with a new process.
- A classified mistap is retried once. That is an unexpected digit from a letter key's long press, or a recorded symbol popup. A second mistap ends the call as inconclusive.

Any other fault after input is not retried, since that input may still arrive. Each attempt has a 180-second deadline. An adb error that means the device is gone ends the call as device offline. A missing letter is not a retry signal, and the driver never retries to get a preferred candidate.

Artifacts of a retry carry a `-retry` suffix. See [running.md](running.md#artifacts).
