import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const onPreBuild = async ({ constants }) => {
  if (!constants.IS_LOCAL || process.platform !== 'win32') return

  const edgeBuilderPath = join(
    process.cwd(),
    '.netlify',
    'plugins',
    'node_modules',
    '@netlify',
    'plugin-nextjs',
    'dist',
    'build',
    'functions',
    'edge.js',
  )

  const cjsRuntimePath = join(
    process.cwd(),
    '.netlify',
    'plugins',
    'node_modules',
    '@netlify',
    'plugin-nextjs',
    'edge-runtime',
    'lib',
    'cjs.ts',
  )

  const originalBuilder = await readFile(edgeBuilderPath, 'utf8')
  const normalizedBuilder = originalBuilder
    .replaceAll(
      'JSON.stringify(join(commonPrefix, fileOrDir))',
      'JSON.stringify(join(commonPrefix, fileOrDir).replaceAll("\\\\", "/"))',
    )
    .replace(
      '${join(commonPrefix, entry)}',
      '${join(commonPrefix, entry).replaceAll("\\\\", "/")}',
    )

  if (normalizedBuilder !== originalBuilder) {
    await writeFile(edgeBuilderPath, normalizedBuilder)
  }

  const originalCjsRuntime = await readFile(cjsRuntimePath, 'utf8')
  const normalizedCjsRuntime = originalCjsRuntime.replaceAll(
    '{ windows: false }',
    '{ windows: true }',
  )

  if (normalizedCjsRuntime !== originalCjsRuntime) {
    await writeFile(cjsRuntimePath, normalizedCjsRuntime)
  }

  console.log('Normalized Netlify Next Runtime virtual module paths for Windows.')
}
