import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The repository root can also hold Codex scratch checkouts
    // (.codex-tmp/, minimum-p1-worktree/) that are not part of the product and
    // must never be discovered as product tests. Without this exclusion the
    // suite runs a duplicate of tests/ui/training-entry-and-media.test.ts against
    // the wrong working tree and reports a false failure.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.next/**',
      '.netlify/**',
      '.codex-tmp/**',
      'minimum-p1-worktree/**',
    ],
  },
})
