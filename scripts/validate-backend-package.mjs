import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const requiredFiles = [
  '.env.example',
  'PAWSIDE_OPENAI_TEST_RUNBOOK.md',
  'scripts/run-next-with-proxy.mjs',
  'scripts/verify-openai-provider.mts',
  'supabase/config.toml',
  'supabase/migrations/20260413000000_v3_food_schema.sql',
  'supabase/migrations/20260904000100_legacy_compatibility_schema.sql',
  'supabase/migrations/20260904000200_method_foundation.sql',
  'supabase/migrations/20260906000100_pawside_backend_activation_hardening.sql',
  'supabase/migrations/20260906000200_workout_guide_media_foundation.sql',
  'supabase/migrations/20260907000100_pawside_performance_advisor_hardening.sql',
  'supabase/migrations/20260909000100_method_source_schema.sql',
  'supabase/migrations/20260909000200_method_release_governance.sql',
  'supabase/migrations/20260909000300_method_evidence_and_policy.sql',
  'supabase/migrations/20260909000400_method_release_security.sql',
  'supabase/migrations/20260909000500_workout_guide_method_catalog.sql',
  'supabase/migrations/20260909000600_method_v1_2_validated_draft.sql',
  'supabase/migrations/20260910000100_method_enrollment_foundation.sql',
  'supabase/tests/pawside_backend_contract.sql',
  'supabase/tests/workout_guide_media_contract.sql',
  'supabase/tests/pawside_performance_contract.sql',
  'supabase/tests/method_release_contract.sql',
  'supabase/tests/method_import_contract.sql',
  'supabase/tests/method_v1_2_draft_contract.sql',
  'supabase/tests/method_enrollment_contract.sql',
  'supabase/seeds/seed_food_data.sql',
  'supabase/seeds/seed_canonical_patch.sql',
  'supabase/seeds/seed_portion_templates.sql',
]

let failed = false

function pass(message) {
  console.log(`PASS ${message}`)
}

function fail(message) {
  failed = true
  console.error(`FAIL ${message}`)
}

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    fail(`missing ${file}`)
    continue
  }
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)
  pass(`${file} sha256:${digest}`)
}

if (existsSync('supabase/config.toml')) {
  const config = readFileSync('supabase/config.toml', 'utf8')
  if (/project_id\s*=\s*"pawside"/.test(config)) pass('local project_id is Pawside')
  else fail('local project_id must be Pawside')

  if (/\[db\.seed\][\s\S]*?enabled\s*=\s*false/.test(config)) pass('automatic database seeding is disabled')
  else fail('automatic database seeding must remain disabled')
}

if (existsSync('package.json')) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  if (pkg.dependencies?.['@bryllim/workout-guide'] === '1.0.0') pass('workout-guide dependency is pinned at 1.0.0')
  else fail('workout-guide dependency must be pinned at 1.0.0')
}

const envFiles = ['.env.local', '.env']
const declaredEnvNames = new Set()
for (const envFile of envFiles) {
  if (!existsSync(envFile)) continue
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (match) declaredEnvNames.add(match[1])
  }
}

for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  if (process.env[name] || declaredEnvNames.has(name)) pass(`${name} is declared (value not displayed; target unverified)`)
  else fail(`${name} is not declared`)
}

const missingRuntimeConfig = []
if (declaredEnvNames.has('NEXT_PUBLIC_OPENAI_API_KEY')) {
  fail('OPENAI_API_KEY must never use the NEXT_PUBLIC_ prefix')
}
if (process.env.OPENAI_API_KEY || declaredEnvNames.has('OPENAI_API_KEY')) {
  pass('OPENAI_API_KEY is declared as a server-only variable (value not displayed)')
} else {
  missingRuntimeConfig.push('OPENAI_API_KEY')
  console.warn('HOLD OPENAI_API_KEY is not declared; OpenAI live calls will use explicit fallback behavior')
}

function commandAvailable(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return result.status === 0
}

const toolChecks = [
  ['Supabase CLI', 'supabase', ['--version']],
  ['Docker', 'docker', ['--version']],
  ['psql', 'psql', ['--version']],
]

const missingTools = []
for (const [label, command, args] of toolChecks) {
  if (commandAvailable(command, args)) pass(`${label} is available`)
  else {
    missingTools.push(label)
    console.warn(`HOLD ${label} is not available`)
  }
}

if (failed) {
  console.error('\nRESULT INVALID_PACKAGE')
  process.exitCode = 1
} else if (missingTools.length > 0 || missingRuntimeConfig.length > 0) {
  const holds = [
    ...missingTools.map(label => `${label} missing`),
    ...missingRuntimeConfig.map(label => `${label} missing`),
  ]
  console.log(`\nRESULT READY_TO_APPLY / HOLD (${holds.join(', ')})`)
} else {
  console.log('\nRESULT READY_FOR_LOCAL_DB_RESET (remote target remains unverified)')
}
