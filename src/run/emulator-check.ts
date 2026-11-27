/**
 * Why the SDK's emulator is not the pinned build, or `undefined` when its `source.properties` names that build.
 * `properties` is `undefined` when the file does not exist.
 */
export function emulatorMismatch(
  properties: string | undefined,
  build: string,
): string | undefined {
  if (properties === undefined) {
    return 'the SDK has no emulator/source.properties'
  }
  const found = /^Pkg\.BuildId\s*=\s*(.*)$/m.exec(properties)?.[1]?.trim()
  if (found === undefined || found === '') {
    return 'emulator/source.properties names no build'
  }
  if (found === build) {
    return undefined
  }
  const revision = /^Pkg\.Revision\s*=\s*(.*)$/m.exec(properties)?.[1]?.trim()
  return `the emulator is build ${found}${revision ? ` (version ${revision})` : ''}, not the pinned build ${build}`
}
