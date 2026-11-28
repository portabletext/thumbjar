import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {type Verdict, writeVerdict} from './verdict.ts'

let directory: string
let root: string
let outDir: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'thumbjar-verdict-'))
  root = join(directory, 'project')
  outDir = join(root, 'out')
  mkdirSync(join(root, 'test'), {recursive: true})
  writeFileSync(join(root, 'test', 'a.test.ts'), '')
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(directory, {recursive: true, force: true})
})

const entry = (file: string, project = 'other') => ({
  project,
  platform: 'android' as const,
  file,
  name: 't',
  outcome: 'passed' as const,
  artifacts: [],
})

const write = () =>
  writeVerdict({
    outDir,
    root,
    project: 'device',
    file: 'test/b.test.ts',
    tests: [entry('test/b.test.ts', 'device')],
    thumbjar: '0.0.0',
  })

const read = () =>
  JSON.parse(readFileSync(join(outDir, 'verdict.json'), 'utf8')) as Verdict

describe(writeVerdict.name, () => {
  test('leaves a file at the old fixed temporary path untouched and leaves no temporary behind', () => {
    mkdirSync(outDir)
    const planted = join(outDir, 'verdict.json.tmp')
    writeFileSync(planted, 'planted')
    write()
    expect(readFileSync(planted, 'utf8')).toBe('planted')
    expect(read().tests.map((test) => test.file)).toEqual(['test/b.test.ts'])
    expect(readdirSync(outDir).sort()).toEqual([
      'verdict.json',
      'verdict.json.tmp',
    ])
  })

  test('drops earlier entries whose file is absolute or outside the root', () => {
    mkdirSync(outDir)
    writeFileSync(join(directory, 'outside.test.ts'), '')
    const earlier: Verdict = {
      version: 1,
      thumbjar: '0.0.0',
      counts: {} as Verdict['counts'],
      tests: [
        entry('test/a.test.ts'),
        entry(join(root, 'test', 'a.test.ts')),
        entry('../outside.test.ts', 'device'),
        entry('test/../../outside.test.ts'),
        entry('/etc/passwd', 'device'),
      ],
    }
    writeFileSync(join(outDir, 'verdict.json'), JSON.stringify(earlier))
    write()
    expect(read().tests.map(({project, file}) => `${project} ${file}`)).toEqual(
      ['other test/a.test.ts', 'device test/b.test.ts'],
    )
  })

  test('replaces, with a warning, an earlier file that is not a version 1 verdict', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mkdirSync(outDir)
    writeFileSync(
      join(outDir, 'verdict.json'),
      JSON.stringify({
        version: 1,
        tests: [entry('test/a.test.ts'), {file: 'test/a.test.ts'}],
      }),
    )
    write()
    expect(read().tests.map((test) => test.file)).toEqual(['test/b.test.ts'])
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('is not a version 1 verdict'),
    )
  })
})
