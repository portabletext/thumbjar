import {fileURLToPath} from 'node:url'
import {deviceProject} from 'thumbjar/vitest'
import {defineConfig} from 'vitest/config'

/**
 * The Slate vs PTE comparison, run by `.github/workflows/demo.yml` from this directory with
 * `thumbjar run`. `slate.html`, `pte.html` and `plain.html` are built into `page/` by `npm run build`.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    reporters:
      process.env.GITHUB_ACTIONS === 'true'
        ? ['default', 'github-actions']
        : ['default'],
    projects: [
      deviceProject({
        include: ['tests/*.test.ts'],
        outDir: fileURLToPath(new URL('out', import.meta.url)),
        pageUrl: 'http://localhost:8765/slate.html',
        summaryFile: process.env.GITHUB_STEP_SUMMARY,
        pageHint:
          'Run `npm run build` in `demo/` and serve `demo/page` with `thumbjar serve`.',
      }),
    ],
  },
})
