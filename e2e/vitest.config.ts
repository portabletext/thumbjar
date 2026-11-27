import {fileURLToPath} from 'node:url'
import {deviceProject} from 'thumbjar/vitest'
import {defineConfig} from 'vitest/config'

/**
 * thumbjar's own device tests, run by `.github/workflows/device.yml` from this directory with
 * `thumbjar run`. `editor.html` is the correct page and `beforeinput.html` the planted bug.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Vitest puts its results cache in `node_modules/.vite` under `root`. A `node_modules` here would make npm take this
  // directory as the package, where `npx --no thumbjar` in `android/action.yml` cannot find thumbjar's own bin.
  cacheDir: fileURLToPath(new URL('../node_modules/.vite', import.meta.url)),
  test: {
    reporters:
      process.env.GITHUB_ACTIONS === 'true'
        ? ['default', 'github-actions']
        : ['default'],
    projects: [
      deviceProject({
        include: ['tests/*.test.ts'],
        outDir: fileURLToPath(new URL('out', import.meta.url)),
        pageUrl: 'http://localhost:8765/editor.html',
        summaryFile: process.env.GITHUB_STEP_SUMMARY,
        pageHint:
          'Run `pnpm build`, copy `dist/page.js` to `e2e/page/page.js` and serve `e2e/page` with `thumbjar serve`.',
      }),
    ],
  },
})
