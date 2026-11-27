# Setting up the page

thumbjar types into a page you build and serve. That page calls `recordInput` from `thumbjar/page` once. The driver then reads the page's text, selection and events over the Chrome DevTools protocol.

## recordInput

```ts
import {recordInput} from 'thumbjar/page'

const field = document.querySelector<HTMLElement>('[contenteditable]')!
field.textContent = new URL(location.href).searchParams.get('prefix') ?? ''

recordInput({
  field,
  getText: () => field.textContent,
  getState: () => ({length: field.textContent?.length ?? 0}),
  actions: {
    clear: () => {
      field.textContent = ''
    },
  },
})
```

`recordInput` takes these options.

- `getText` returns the text your test asserts on, as a string or `null`. Read it from your editor's model when it has one.
- `getState` is optional and returns more state, such as your editor's document. Keep it JSON-serializable so it can cross the DevTools connection.
- `actions` is optional and maps names to handlers that page steps await. See [cases.md](cases.md#page-steps).
- `field` is optional and names the element to type into and record on.

Exceptions thrown from `getText` and `getState` reach the driver.

## The prefix

`runOnDevice` sets the page URL's `prefix` search parameter to the case's `prefix`. It adds the parameter or replaces it if the URL already has one. Read it in your page and put that text in the field before the keyboard types.

Seed the field and then leave it to the keyboard. A page that writes the field's `value` back from its own state on every input, the way a React `value` prop does, restarts Gboard's composition.

## Finding the field

With `field`, events are recorded on that element.

Without `field`, events are recorded on `document` in the capture phase. The driver types into the first element matching `TEXT_FIELD_SELECTOR`, which `thumbjar/page` exports. It matches `textarea`, `[contenteditable]` and `input` elements of type `text`, `search`, `tel`, `url` or `password`, or with no type or an empty type. The field may render after `recordInput` runs.

A field's text is its `value` for an `input` or a `textarea` and its `textContent` otherwise.

## What gets recorded

The recorder listens for `beforeinput`, `input`, `compositionstart`, `compositionupdate` and `compositionend`. Each event record has these properties.

- `type`, `inputType` and `data`.
- `text`, the field's text when the event fired.
- `selection`, the field's selection as `{anchor, focus}` in UTF-16 offsets, or `null` when it is outside the field. Anchor and focus keep their direction.

`beforeinput` and `input` records also have these.

- `isComposing` and `cancelable`.
- `targetRanges`, when the browser supports it. Each range is `{start, end}` in UTF-16 offsets, or `null` for a range outside the field. No ranges gives `[]`.
- `defaultPrevented`, read by a zero-delay timer after the whole dispatch. Until then it is absent. Absent means unknown, never `false`.

A property that throws when read is recorded as `null`.

If the page has a `#log` element, the recorder prints the event records into it.

## What the driver reads

`recordInput` installs `window.__state`, `window.__field`, `window.__selection` and `window.__action` for the driver. `window.__state()` returns `{text, events}`, plus `state` when you pass `getState`. Without `field` it also returns `dom`, the text of the field the driver types into.
