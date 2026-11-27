// A minimal Portable Text Editor, wired to `recordInput` the way portabletext/editor's own Android page
// (packages/editor/android/page/editor.tsx on `next`) does, with a `strong` decorator rendered as
// `<strong>`.
import {
  defineDecorator,
  defineSchema,
  EditorProvider,
  PortableTextEditable,
  useEditor,
} from '@portabletext/editor'
import {NodePlugin} from '@portabletext/editor/plugins'
import {
  blockOffsetToSpanSelectionPoint,
  getTextBlockText,
  isTextBlock,
} from '@portabletext/editor/utils'
import {useEffect} from 'react'
import {createRoot} from 'react-dom/client'
import {recordInput} from 'thumbjar/page'
import {big, fontSize, heading} from './big.ts'
import {caretOffset, initialRuns, settle} from './seed.ts'

const schemaDefinition = defineSchema({
  styles: [{name: 'normal'}],
  decorators: [{name: 'strong'}],
})

const nodes = [
  defineDecorator({
    type: 'strong',
    render: ({children}) => <strong>{children}</strong>,
  }),
]

// Deterministic keys, like the editor's own page uses `createTestKeyGenerator`.
let keyCount = 0
const keyGenerator = () => `k${keyCount++}`

const initialValue = [
  {
    _type: 'block',
    _key: keyGenerator(),
    style: 'normal',
    markDefs: [],
    children: initialRuns().map(({text, bold}) => ({
      _type: 'span',
      _key: keyGenerator(),
      text,
      marks: bold ? ['strong'] : [],
    })),
  },
]

function Probe() {
  const editor = useEditor()
  useEffect(() => {
    recordInput({
      getState: () => {
        const {context} = editor.getSnapshot()
        return {value: context.value, selection: context.selection}
      },
      getText: () => {
        const {context} = editor.getSnapshot()
        return (context.value ?? [])
          .map((block) =>
            isTextBlock(context, block) ? getTextBlockText(block) : '',
          )
          .join('\n')
      },
      actions: {
        caret: async (args) => {
          const offset = caretOffset(args)
          const snapshot = editor.getSnapshot()
          const first = snapshot.context.value[0]
          if (!first) {
            throw new Error('No first block')
          }
          // `backward` lands an offset on a span boundary at the end of the earlier span, as the Slate page does.
          const point = blockOffsetToSpanSelectionPoint({
            snapshot,
            blockOffset: {path: [{_key: first._key}], offset},
            direction: 'backward',
          })
          if (!point) {
            throw new Error(`No span point at offset ${offset}`)
          }
          editor.send({type: 'focus'})
          editor.send({type: 'select', at: {anchor: point, focus: point}})
          await settle()
        },
      },
    })
  }, [editor])
  return null
}

function App() {
  return (
    <EditorProvider
      initialConfig={{schemaDefinition, initialValue, keyGenerator}}
    >
      <NodePlugin nodes={nodes} />
      <Probe />
      {big ? <h1 style={{fontSize: 28}}>{heading('pte')}</h1> : null}
      <PortableTextEditable
        style={{border: '1px solid #888', minHeight: '3em', fontSize}}
      />
    </EditorProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
