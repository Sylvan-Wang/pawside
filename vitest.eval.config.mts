import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Only the model evaluation (tests/eval/*.eval.ts). Run it with `npm run coach:eval`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: { include: ['tests/eval/**/*.eval.ts'], testTimeout: 90_000, reporters: ['default'] },
})
