// `big=1` in the page's search params, set only by the screen-recording tests (`tests/record.*.test.ts`):
// a larger font and a heading naming the editor, so the recording is readable.

declare const __SLATE_REACT_VERSION__: string
declare const __PTE_VERSION__: string

export const big = new URLSearchParams(location.search).get('big') === '1'

/** The editor's font size in px. */
export const fontSize = big ? 32 : 20

/** The heading above the field on a `big=1` page, with the version installed when the page was built. */
export function heading(editor: 'slate' | 'pte'): string {
  return editor === 'slate'
    ? `Slate (slate-react ${__SLATE_REACT_VERSION__})`
    : `Portable Text Editor ${__PTE_VERSION__}`
}
