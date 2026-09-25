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
      '**/node_modules/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'supabase/.temp/**',
      '.tmp-spreadsheet/**',
      'artifacts/method-import/**',
      // Codex scratch checkouts / iteration copies are not part of the product
      // tree. Without this, `eslint .` walks their nested node_modules and
      // reports tens of thousands of unrelated problems.
      '.codex-tmp/**',
      'minimum-p1-worktree/**',
    ],
  },
])
