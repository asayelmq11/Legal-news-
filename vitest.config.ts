import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      /*
       * `server-only` resolves to a module that throws on import, which is
       * exactly what should happen in a client bundle and exactly what must not
       * happen in a Node test runner. Aliasing it to an empty module lets the
       * guard modules be unit-tested; the real protection is Next's bundler
       * resolution, which is unaffected by this config.
       */
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
})
