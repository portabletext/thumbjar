// The control: a plain `contenteditable`, as thumbjar's `e2e/page/editor.html`. Seed the field from
// `prefix`, then leave it to the keyboard.
import {recordInput} from 'thumbjar/page'

const field = document.getElementById('ed')!
field.textContent = new URL(location.href).searchParams.get('prefix') ?? ''
recordInput({field, getText: () => field.textContent})
