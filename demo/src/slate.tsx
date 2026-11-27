// A minimal Slate rich-text editor modelled on Slate's richtext example
// (site/examples/ts/richtext.tsx): `withHistory(withReact(createEditor()))`, paragraphs and a `bold`
// leaf mark rendered as `<strong>`, with no toolbar or hotkeys.
import {useCallback, useEffect, useMemo} from 'react'
import {createRoot} from 'react-dom/client'
import {
  createEditor,
  Node,
  Transforms,
  type BaseEditor,
  type Descendant,
} from 'slate'
import {withHistory, type HistoryEditor} from 'slate-history'
import {
  Editable,
  ReactEditor,
  Slate,
  withReact,
  type RenderElementProps,
  type RenderLeafProps,
} from 'slate-react'
import {recordInput} from 'thumbjar/page'
import {caretOffset, initialRuns, locate, settle} from './seed.ts'

type ParagraphElement = {type: 'paragraph'; children: CustomText[]}
type CustomText = {text: string; bold?: true}

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor
    Element: ParagraphElement
    Text: CustomText
  }
}

const initialValue: Descendant[] = [
  {
    type: 'paragraph',
    children: initialRuns().map(({text, bold}) =>
      bold ? {text, bold: true} : {text},
    ),
  },
]

const Element = ({attributes, children}: RenderElementProps) => (
  <p {...attributes}>{children}</p>
)

const Leaf = ({attributes, children, leaf}: RenderLeafProps) => {
  if (leaf.bold) {
    children = <strong>{children}</strong>
  }
  return <span {...attributes}>{children}</span>
}

function App() {
  const editor = useMemo(() => withHistory(withReact(createEditor())), [])
  const renderElement = useCallback(
    (props: RenderElementProps) => <Element {...props} />,
    [],
  )
  const renderLeaf = useCallback(
    (props: RenderLeafProps) => <Leaf {...props} />,
    [],
  )

  useEffect(() => {
    recordInput({
      getText: () =>
        editor.children.map((node) => Node.string(node)).join('\n'),
      getState: () => ({value: editor.children, selection: editor.selection}),
      actions: {
        caret: async (args) => {
          const offset = caretOffset(args)
          const first = editor.children[0]
          if (!first || !('children' in first)) {
            throw new Error('No first block')
          }
          const lengths = first.children.map((child) => child.text.length)
          const at = locate(lengths, offset)
          const point = {path: [0, at.index], offset: at.offset}
          ReactEditor.focus(editor)
          Transforms.select(editor, {anchor: point, focus: point})
          await settle()
        },
      },
    })
  }, [editor])

  return (
    <Slate editor={editor} initialValue={initialValue}>
      <Editable
        aria-label="Rich text editor"
        renderElement={renderElement}
        renderLeaf={renderLeaf}
        spellCheck
        style={{border: '1px solid #888', minHeight: '3em', fontSize: 20}}
      />
    </Slate>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
