/** One run of text in the first block, bold or not. */
export type Run = {text: string; bold: boolean}

/**
 * The first block's runs from the page's search params. `seed` wins over `prefix`, which thumbjar always
 * sets: `seed=bold` gives `plain ` + bold `bold` + ` plain`, `seed=word` gives `helloworld`.
 */
export function initialRuns(): Run[] {
  const params = new URLSearchParams(location.search)
  const seed = params.get('seed')
  if (seed === 'bold') {
    return [
      {text: 'plain ', bold: false},
      {text: 'bold', bold: true},
      {text: ' plain', bold: false},
    ]
  }
  if (seed === 'word') {
    return [{text: 'helloworld', bold: false}]
  }
  if (seed !== null) {
    throw new Error(`Unknown seed: ${seed}`)
  }
  return [{text: params.get('prefix') ?? '', bold: false}]
}

/**
 * The run index and offset in it for a character offset in the block. An offset on a boundary between
 * two runs lands at the end of the earlier run, so offset 10 in the bold seed sits at the end of `bold`.
 */
export function locate(
  lengths: number[],
  offset: number,
): {index: number; offset: number} {
  let left = offset
  for (const [index, length] of lengths.entries()) {
    if (left <= length) {
      return {index, offset: left}
    }
    left -= length
  }
  throw new Error(
    `Offset ${offset} is past the block's ${lengths.reduce((a, b) => a + b, 0)} characters`,
  )
}

export function caretOffset(args: unknown): number {
  const offset =
    typeof args === 'object' && args !== null && 'offset' in args
      ? args.offset
      : undefined
  if (typeof offset !== 'number') {
    throw new Error(`caret takes {offset: number}, got ${JSON.stringify(args)}`)
  }
  return offset
}

/** Two animation frames, so the editor has rendered and synced the DOM selection. */
export function settle(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}
