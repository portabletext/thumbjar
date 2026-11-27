// `timing.txt` holds one block of lines per emulator run, the retry's after the `RETRY` line that
// `thumbjar ci android retry` writes when it decides to retry. `thumbjar run` writes `BOOTED` once its emulator is up,
// `PREP DICTIONARY_NOT_LOADED` when `thumbjar prepare` exits with status 3, and one `CHECKED <verdict>` line
// once its last stage has ended: `skipped` when no check was needed, or the device check's `device` or
// `lost` after a failed stage. A booted run without that line ended before the check reached a verdict.

type RunState = 'never booted' | 'lost' | 'dictionary not loaded' | 'no retry'

/**
 * Whether to run once more after a failed first run: only when its emulator never booted, adb lost the
 * device after boot, or Gboard's Japanese dictionary never loaded on a device the check found reachable,
 * and never after a retry. A test failure on a reachable device is never retried.
 */
export function retryAfter(
  timing: string,
): {retry: false} | {retry: true; line: string} {
  const runs = timing.split(/^RETRY$/m)
  const [first] = runs
  if (runs.length > 1 || first === undefined) {
    return {retry: false}
  }
  const state = runState(first)
  if (state === 'never booted') {
    return {
      retry: true,
      line: 'BOOT_RETRY: the emulator never booted, retrying once on a fresh emulator',
    }
  }
  if (state === 'lost') {
    return {
      retry: true,
      line: 'DEVICE_LOST_RETRY: adb lost the device after boot, retrying once on a fresh emulator',
    }
  }
  if (state === 'dictionary not loaded') {
    return {
      retry: true,
      line: "DICTIONARY_RETRY: Gboard's Japanese dictionary never loaded, retrying once on a fresh emulator",
    }
  }
  return {retry: false}
}

function runState(run: string): RunState {
  if (!/^BOOTED /m.test(run)) {
    return 'never booted'
  }
  const verdict = /^CHECKED (\w+) at \d+$/m.exec(run)?.[1]
  if (verdict === 'lost') {
    return 'lost'
  }
  return verdict === 'device' && /^PREP DICTIONARY_NOT_LOADED$/m.test(run)
    ? 'dictionary not loaded'
    : 'no retry'
}
