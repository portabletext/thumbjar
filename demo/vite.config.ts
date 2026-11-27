import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'

const src = fileURLToPath(new URL('src', import.meta.url))

/** The installed version of `name`, for the heading of a `big=1` page (`src/big.ts`). */
function version(name: string): string {
  const pkg = JSON.parse(
    readFileSync(
      new URL(`node_modules/${name}/package.json`, import.meta.url),
      'utf8',
    ),
  ) as {version: string}
  return pkg.version
}

// Builds `src/slate.html`, `src/pte.html` and `src/plain.html` into `page/`, which `thumbjar serve` serves.
export default defineConfig({
  root: src,
  base: './',
  plugins: [react()],
  define: {
    __SLATE_REACT_VERSION__: JSON.stringify(version('slate-react')),
    __PTE_VERSION__: JSON.stringify(version('@portabletext/editor')),
  },
  build: {
    outDir: fileURLToPath(new URL('page', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        slate: `${src}/slate.html`,
        pte: `${src}/pte.html`,
        plain: `${src}/plain.html`,
      },
    },
  },
})
