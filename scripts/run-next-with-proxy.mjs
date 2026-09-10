import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const nextCommand = process.argv[2]
const allowedCommands = new Set(['dev', 'build', 'start'])

if (!allowedCommands.has(nextCommand)) {
  console.error('Usage: node scripts/run-next-with-proxy.mjs <dev|build|start> [args]')
  process.exit(2)
}

const childEnv = {
  ...process.env,
  NODE_USE_ENV_PROXY: '1',
}

const proxyFile = '.env.proxy.local'
const allowedProxyVariables = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'])

if (existsSync(proxyFile)) {
  for (const line of readFileSync(proxyFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || !allowedProxyVariables.has(match[1])) continue
    childEnv[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

const nextBinary = fileURLToPath(
  new URL('../node_modules/next/dist/bin/next', import.meta.url),
)
const result = spawnSync(
  process.execPath,
  [nextBinary, nextCommand, ...process.argv.slice(3)],
  {
    cwd: process.cwd(),
    env: childEnv,
    stdio: 'inherit',
  },
)

if (result.error) {
  console.error(result.error.message)
  process.exitCode = 1
} else {
  process.exitCode = result.status ?? 1
}
