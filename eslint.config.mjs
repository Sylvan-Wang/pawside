import { defineConfig } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    ignores: [
      '.next/**',
      '.netlify/**',
      'node_modules/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'supabase/.temp/**',
      '.tmp-spreadsheet/**',
      'artifacts/method-import/**',
    ],
  },
])
