import {fileURLToPath} from 'node:url'
import react from '@vitejs/plugin-react'
import {defineConfig} from 'vite'

const src = fileURLToPath(new URL('src', import.meta.url))

// Builds `src/slate.html`, `src/pte.html` and `src/plain.html` into `page/`, which `thumbjar serve` serves.
export default defineConfig({
  root: src,
  base: './',
  plugins: [react()],
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
