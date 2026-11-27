// `big=1` in the page's search params, set only by the screen-recording tests (`tests/record.*.test.ts`):
// a larger font and a heading naming the editor, so the recording is readable.

declare const __SLATE_REACT_VERSION__: string
declare const __PTE_VERSION__: string

const params = new URLSearchParams(location.search)

export const big = params.get('big') === '1'

/**
 * `env=…`, the browser and keyboard the recording ran on, which the record test reads from the device
 * (`dumpsys package`) and passes in, so the caption names what actually ran.
 */
const env = params.get('env')

/** The editor's font size in px. */
export const fontSize = big ? 32 : 20

/**
 * The heading above the field on a `big=1` page: the editor with the version installed when the page was
 * built, and `env` when given.
 */
export function heading(editor: 'slate' | 'pte'): string {
  const name =
    editor === 'slate'
      ? `Slate (slate-react ${__SLATE_REACT_VERSION__})`
      : `Portable Text Editor ${__PTE_VERSION__}`
  return env === null ? name : `${name}, ${env}`
}
