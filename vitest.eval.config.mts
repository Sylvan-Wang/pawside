import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// Only the model evaluation (tests/eval/*.eval.ts). Run it with `npm run coach:eval`.
// vitest does not read .env.local by itself, so load it here (real env vars still win).
export default defineConfig(({ mode }) => {
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    if (process.env[k] === undefined) process.env[k] = v
  }
  return {
    resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
    test: { include: ['tests/eval/**/*.eval.ts'], testTimeout: 90_000, reporters: ['default'] },
  }
})
