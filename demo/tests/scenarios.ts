import {appendFileSync, mkdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {runOnDevice, type Run, type Step} from 'thumbjar'
import {expect, test} from 'vitest'

type Editor = 'slate' | 'pte' | 'plain'
type Keyboard = 'ja' | 'en'

type Scenario = {
  name: string
  prefix: string
  seed?: 'bold' | 'word'
  steps: Step[]
  /** Accepted final texts, asserted softly. Absent where there is no obvious right answer. */
  expected?: string[]
  /** The offset a leading `caret` page step must leave the selection at. */
  caret?: number
}

/** Whether `editor` runs `scenario`: the plain control has no seed and no `caret` action. */
function runs(editor: Editor, scenario: Scenario): boolean {
  return (
    editor !== 'plain' ||
    (scenario.seed === undefined &&
      !scenario.steps.some((step) => step.type === 'page'))
  )
}

/** The installed versions the pages were built from, read from `demo/node_modules`. */
const VERSIONS = Object.fromEntries(
  ['slate', 'slate-react', '@portabletext/editor'].map((name) => [
    name,
    (
      JSON.parse(
        readFileSync(
          new URL(`../node_modules/${name}/package.json`, import.meta.url),
          'utf8',
        ),
      ) as {version: string}
    ).version,
  ]),
)

const SCENARIOS: Record<Keyboard, Scenario[]> = {
  ja: [
    {
      // Nov 1 (slate-react 0.147.5 vs PTE 8.2.10): Slate gave 'きょう\u3000きょう', only while Gboard's
      // dictionary was still loading.
      name: 'Space commits kana in an empty field',
      prefix: '',
      steps: [
        {type: 'compose', letters: 'kyou', commit: 'space'},
        {type: 'compose', letters: 'kyou', commit: 'space'},
      ],
      expected: ['きょうきょう', '今日今日'],
    },
    {
      name: 'Converting kyou to 今日 twice',
      prefix: '',
      steps: [
        {type: 'compose', letters: 'kyou', commit: {candidate: '今日'}},
        {type: 'compose', letters: 'kyou', commit: {candidate: '今日'}},
      ],
      expected: ['今日今日'],
    },
    {
      name: 'Composing kyou',
      prefix: '',
      steps: [{type: 'compose', letters: 'kyou', commit: 'none'}],
      expected: ['きょう'],
    },
    {
      name: 'Converting kyou to 今日 after x',
      prefix: 'x',
      steps: [{type: 'compose', letters: 'kyou', commit: {candidate: '今日'}}],
      expected: ['x今日'],
    },
  ],
  en: [
    {
      // Nov 1 (slate-react 0.147.5 vs PTE 8.2.10): Slate gave lowercase 'kyou'.
      name: 'First word in an empty field',
      prefix: '',
      steps: [
        {type: 'compose', letters: 'kyou', commit: 'space'},
        {type: 'compose', letters: 'kyou', commit: 'space'},
      ],
      expected: ['Kyou kyou ', 'Kyou kyou ', 'Kyou kyou'],
    },
    {
      name: 'Typing kyou twice after x',
      prefix: 'x',
      steps: [
        {type: 'compose', letters: 'kyou', commit: 'space'},
        {type: 'compose', letters: 'kyou', commit: 'space'},
      ],
      expected: ['xkyou kyou ', 'xkyou kyou ', 'xkyou kyou'],
    },
    {
      // Autocorrect: no expected text, the result is the data.
      name: 'Typing teh and space',
      prefix: '',
      steps: [{type: 'compose', letters: 'teh', commit: 'space'}],
    },
    {
      name: 'Pressing Enter between hello and world',
      prefix: '',
      seed: 'word',
      steps: [
        {type: 'page', action: 'caret', args: {offset: 5}},
        {type: 'enter'},
      ],
      caret: 5,
      expected: ['hello\nworld'],
    },
    {
      name: 'Backspacing twice after bold',
      prefix: '',
      seed: 'bold',
      steps: [
        {type: 'page', action: 'caret', args: {offset: 10}},
        {type: 'backspace', times: 2},
      ],
      caret: 10,
      expected: ['plain bo plain'],
    },
    {
      // Gboard may pick up `bold` as the word around the caret; no expected text.
      name: 'Typing xy and space inside bold',
      prefix: '',
      seed: 'bold',
      steps: [
        {type: 'page', action: 'caret', args: {offset: 8}},
        {type: 'compose', letters: 'xy', commit: 'space'},
      ],
      caret: 8,
    },
  ],
}

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

function writeResult(line: Record<string, unknown>): void {
  const outDir = process.env.THUMBJAR_OUT_DIR ?? 'out'
  mkdirSync(outDir, {recursive: true})
  appendFileSync(join(outDir, 'results.jsonl'), `${JSON.stringify(line)}\n`)
}

/**
 * Declare one test per scenario of `keyboard` against `editor`'s page. `declaredCount` must equal the
 * file's `// thumbjar-test-count:` line, which `thumbjar run` reads to size the test stage's timeout
 * because the `test(` calls live here, not in the file.
 */
export function defineScenarios(
  editor: Editor,
  keyboard: Keyboard,
  declaredCount: number,
): void {
  const scenarios = SCENARIOS[keyboard].filter((scenario) =>
    runs(editor, scenario),
  )
  if (scenarios.length !== declaredCount) {
    throw new Error(
      `${editor}.${keyboard}.test.ts declares ${declaredCount} tests but scenarios.ts has ${scenarios.length}; update its thumbjar-test-count line`,
    )
  }
  for (const scenario of scenarios) {
    test(`Scenario: ${editor}: ${scenario.name}`, async (context) => {
      const url = new URL(`http://localhost:8765/${editor}.html`)
      if (scenario.seed) {
        url.searchParams.set('seed', scenario.seed)
      }
      const base = {
        editor,
        keyboard,
        scenario: scenario.name,
        versions: VERSIONS,
      }
      let run: Run
      try {
        run = await runOnDevice(context, {
          keyboard,
          url: url.href,
          prefix: scenario.prefix,
          steps: scenario.steps,
        })
      } catch (error) {
        // A step the driver could not finish, such as a candidate Gboard did not offer, is a result too.
        // The step records are in the error message and in `out/<keyboard>-<slug>.json`.
        writeResult({
          ...base,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
      const nested = nestedCompositions(run)
      writeResult({
        ...base,
        text: run.text,
        state: run.state,
        steps: run.steps.map((step) => ({
          type: step.type,
          status: step.status,
          ...(step.reason === undefined ? {} : {reason: step.reason}),
          textAfter: step.textAfter,
          selectionAfter: step.selectionAfter,
        })),
        compositionstartPerStep: compositionstartPerStep(run),
        nested,
      })

      if (scenario.caret !== undefined) {
        expect
          .soft(run.steps[0]?.selectionAfter, 'caret landed')
          .toEqual({anchor: scenario.caret, focus: scenario.caret})
      }
      if (scenario.expected) {
        expect.soft(run.text, 'text').toBeOneOf(scenario.expected)
      }
      expect.soft(nested, 'nested compositions').toBe(0)
    })
  }
}
