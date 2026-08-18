import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        vue: resolve(import.meta.dirname, 'src/adapters/vue/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['vue'],
    },
  },
})
