// The action caches the system image the emulator runner installs, the largest download of a run, under a key
// naming the revision `sdkmanager` would install now: a new revision is a miss, so a hit never boots an outdated
// image and the runner's own install finds the image current and downloads nothing. The emulator is not cached:
// the runner downloads `emulator-build` on every run whatever the SDK holds.

/** The system image the action boots, relative to the SDK root. */
export function systemImagePath(api: string): string {
  return `system-images/android-${api}/google_apis_playstore/x86_64`
}

/**
 * The cache key for the system image from the output of `sdkmanager --list`, or `undefined` when its available
 * packages do not list the image. Only the available revision selects the key, never an installed one.
 */
export function sdkCacheKey(
  list: string,
  api: string,
  os: string,
): string | undefined {
  const available = list.split(/^Available Packages:$/m)[1] ?? ''
  const revision = available
    .split('\n')
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .find(
      (cells) =>
        cells[0] ===
        `system-images;android-${api};google_apis_playstore;x86_64`,
    )?.[1]
  return revision === undefined || revision === ''
    ? undefined
    : `thumbjar-android-sdk-${os}-api${api}-google_apis_playstore-x86_64-image${revision}`
}
