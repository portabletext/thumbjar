// thumbjar-test-count: 6
// `thumbjar run` sizes the file's cap from this line: about 4600 s, which covers the version record and
// 18 probe runs of about two minutes each with room to spare. The tests are declared in `probe.ts`.
import {defineProbe} from './probe.ts'

defineProbe()
