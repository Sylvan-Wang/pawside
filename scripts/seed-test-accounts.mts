// Pawside — seed 3 test accounts with realistic history (Sylvan's request,
// 2026-09-28). NOT run automatically anywhere; a human runs this once,
// against whichever Supabase project they point it at.
//
// WHAT THIS DOES
// --------------
// Creates 3 auth users and drives them through the REAL app routes
// (/api/onboarding, /api/training/*, /api/nutrition/food-log,
// /api/body-metrics, /api/recovery/checkin) — never re-implements the
// business logic those routes already enforce (target calculation, Method
// enrollment, set/exercise completion counting, ...). The only place this
// script touches tables directly (via the service-role key) is to backdate
// timestamps afterward, since several routes always stamp "now()" and have
// no "as of this date" parameter (training's started_at/completed_at, body
// metrics' date).
//
// Three personas (docs/coach/PATCH_B_2026-09-27.md's spirit — cover the
// states Appendix A calls out):
//   MODEL        - 4 weeks, every split done, 3 meals/day, weekly weigh-in.
//   INTERMITTENT - spotty: skipped days, a meal logged with just breakfast,
//                  and one session started 13 days ago and never finished
//                  (exercises B5's stale-session banner + D1-style duration).
//   NEW          - onboarded only, 0 days of history (insufficient states).
//
// HOW AUTH WORKS AGAINST REAL APP ROUTES
// ---------------------------------------
// The app's API routes read the session from a cookie via @supabase/ssr
// (lib/supabase/server.ts), not a Bearer header. This script signs in as
// each test user with the anon key, then reconstructs the exact cookie
// @supabase/ssr writes (`sb-<project-ref>-auth-token`, base64url-encoded
// JSON of the session) and sends it as a normal Cookie header. This is the
// same trick used in supabase/ssr's own test suite. If @supabase/ssr ever
// changes that format, the very first authenticated call below will fail
// with a clear 401 — see verifyAuth().
//
// REQUIRED ENV (put them in .env.local or export before running; never
// commit them)
//   NEXT_PUBLIC_SUPABASE_URL       - same project the app itself points at
//   NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY      - Project Settings -> API -> service_role.
//                                    Used only for admin.createUser and the
//                                    backdating updates below.
//   SEED_APP_BASE_URL              - the deployed app to call, e.g.
//                                    https://<your-netlify-site>.netlify.app
//                                    or http://localhost:3000 for a local dev
//                                    server pointed at the same Supabase project.
//
// RUN
//   node --no-warnings --env-file-if-exists=.env.local \
//     --experimental-strip-types scripts/seed-test-accounts.mts
//
// SAFETY
//   - Only ever touches rows owned by the 3 users this script creates
//     (matched by user_id, which comes back from auth.admin.createUser).
//     It never reads or writes method_releases or any other user's data.
//   - Prints a `delete from auth.users where email in (...)` statement at
//     the end (every table here has `on delete cascade` from user_id) —
//     run that yourself in the SQL editor when you're done testing.
//   - Safe to re-run: an email that already exists is reported and skipped
//     rather than erroring the whole run.

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
const SUPABASE_ANON_KEY = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const APP_BASE_URL = requireEnv('SEED_APP_BASE_URL').replace(/\/$/, '')
const TIME_ZONE = 'Asia/Shanghai'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required env var ${name}. See the header comment of this script.`)
    process.exit(1)
  }
  return value
}

function projectRef(url: string): string {
  const match = url.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i)
  if (!match) throw new Error(`Could not extract project ref from ${url}`)
  return match[1]
}

const admin = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// --- day helpers ------------------------------------------------------------

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(n: number, hour = 18, minute = 0): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  d.setUTCHours(hour - 8, minute, 0, 0) // TIME_ZONE is UTC+8; store as UTC instant.
  return d
}

function isoOf(d: Date): string {
  return d.toISOString()
}

// --- HTTP helpers against the real app -------------------------------------

/**
 * Reconstructs the exact cookie @supabase/ssr writes for a session, so the
 * app's own route handlers (which read cookies, not a Bearer header) see a
 * normal logged-in request. See the file header for why this is safe.
 */
function buildAuthCookie(session: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number; token_type?: string; user: unknown }): string {
  const ref = projectRef(SUPABASE_URL)
  const cookieName = `sb-${ref}-auth-token`
  const payload = JSON.stringify(session)
  const encoded = 'base64-' + Buffer.from(payload).toString('base64url')
  return `${cookieName}=${encoded}`
}

interface ApiResult {
  ok: boolean
  status: number
  // Response shapes vary per route; callers narrow what they need.
  data: Record<string, unknown> & { data?: Record<string, unknown> }
}

async function callApi(cookie: string, method: string, path: string, body?: unknown): Promise<ApiResult> {
  const response = await fetch(`${APP_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data: Record<string, unknown> = {}
  try { data = await response.json() } catch { /* empty body */ }
  return { ok: response.ok, status: response.status, data }
}

async function verifyAuth(cookie: string, label: string) {
  // /api/nutrition/daily is cheap and requires a real session; use it as a
  // canary so an auth-cookie mismatch fails loudly here, not 40 calls later.
  const today = dateKey(new Date())
  const result = await callApi(cookie, 'GET', `/api/nutrition/daily?date=${today}`)
  if (!result.ok) {
    throw new Error(
      `[${label}] the reconstructed auth cookie was rejected (status ${result.status}). ` +
      `@supabase/ssr's cookie format may have changed — see this script's header comment. ` +
      `Response: ${JSON.stringify(result.data)}`,
    )
  }
}

// --- account + onboarding ----------------------------------------------------

interface TestAccount {
  label: string
  email: string
  password: string
  userId: string
  cookie: string
}

async function createTestUser(label: string, email: string, password: string): Promise<TestAccount> {
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { seed: 'pawside-test-account', persona: label },
  })
  let userId: string
  if (createError) {
    if (!/already been registered|already exists/i.test(createError.message)) throw createError
    console.log(`[${label}] ${email} already exists, reusing it.`)
    const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 })
    if (listError) throw listError
    const existing = list.users.find((u) => u.email === email)
    if (!existing) throw new Error(`${email} reported as existing but not found in listUsers()`)
    userId = existing.id
  } else {
    userId = created.user.id
  }

  const anon = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password })
  if (signInError || !signIn.session) throw signInError ?? new Error('sign-in returned no session')

  const cookie = buildAuthCookie(signIn.session)
  await verifyAuth(cookie, label)
  console.log(`[${label}] signed in as ${email} (${userId})`)
  return { label, email, password, userId, cookie }
}

/** POST /api/onboarding, mirroring what app/onboarding/page.tsx sends. */
async function onboardAndJoinMethod(account: TestAccount, opts: { weightKg: number; heightCm: number }) {
  const result = await callApi(account.cookie, 'POST', '/api/onboarding', {
    goal: 'gain_muscle',
    gender: 'male',
    height_cm: opts.heightCm,
    reference_weight_kg: opts.weightKg,
    weight_unit: 'kg',
    daily_calorie_target: 2400,
    weekly_workout_target: 3,
    time_zone: TIME_ZONE,
    capability_profile: {
      training_experience: 'some_experience',
      pushup_capacity: 'six_to_fifteen',
      equipment_access: 'full_gym',
      preferred_session_minutes: 60,
    },
    join_method: true,
  })
  if (!result.ok) throw new Error(`[${account.label}] onboarding failed: ${JSON.stringify(result.data)}`)
  console.log(`[${account.label}] onboarded + joined Method`)
}

async function getFirstPrescriptionId(userId: string): Promise<string> {
  const { data, error } = await admin
    .from('session_prescriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'upcoming')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('No upcoming session_prescriptions row found after onboarding — did join_method succeed?')
  return data.id as string
}

// --- one training day ---------------------------------------------------------

interface SetPrescription {
  id: string
  set_index: number
  target_reps_min: number | null
  target_reps_max: number | null
  target_rir: number | null
}
interface ExerciseExecution {
  id: string
  prescription: { sets: SetPrescription[] } | { sets: SetPrescription[] }[] | null
}

/**
 * Starts a prescription, saves a plausible actual for every prescribed set
 * (skipping some when `completeness < 1` to produce a partial/record-
 * incomplete day), and — unless `leaveOpen` — completes the session.
 * Returns the session id and the completion response's next_prescription_id
 * (null if left open).
 */
async function runTrainingDay(
  account: TestAccount,
  prescriptionId: string,
  viewDate: string,
  weightByExercise: Map<string, number>,
  opts: { completeness: number; leaveOpen?: boolean },
): Promise<{ sessionId: string; nextPrescriptionId: string | null }> {
  const start = await callApi(account.cookie, 'POST', `/api/training/${prescriptionId}/start`, {
    view_date: viewDate,
    time_zone: TIME_ZONE,
    start_request_id: crypto.randomUUID(),
  })
  if (!start.ok) throw new Error(`[${account.label}] start failed: ${JSON.stringify(start.data)}`)
  const startData = (start.data.data ?? {}) as { id?: string; session_id?: string }
  const sessionId = (startData.id ?? startData.session_id) as string
  if (!sessionId) throw new Error(`[${account.label}] start response had no session id: ${JSON.stringify(start.data)}`)

  const detail = await callApi(account.cookie, 'GET', `/api/training/sessions/${sessionId}`)
  if (!detail.ok) throw new Error(`[${account.label}] session detail failed: ${JSON.stringify(detail.data)}`)
  const executions = ((detail.data.data ?? {}) as { exercises?: ExerciseExecution[] }).exercises ?? []

  for (const execution of executions) {
    const prescription = Array.isArray(execution.prescription) ? execution.prescription[0] : execution.prescription
    const sets = prescription?.sets ?? []
    const setsToLog = Math.max(1, Math.round(sets.length * opts.completeness))
    const baseWeight = weightByExercise.get(execution.id) ?? 20 + Math.round(Math.random() * 30)

    for (const set of sets.slice(0, setsToLog).sort((a, b) => a.set_index - b.set_index)) {
      const reps = set.target_reps_max ?? set.target_reps_min ?? 10
      const saved = await callApi(account.cookie, 'PUT', `/api/training/sessions/${sessionId}/sets`, {
        exercise_execution_id: execution.id,
        set_index: set.set_index,
        actual_weight_kg: Math.round(baseWeight * 2) / 2,
        actual_reps: reps,
        actual_rir: set.target_rir ?? 2,
      })
      if (!saved.ok) {
        console.warn(`[${account.label}] set save failed (kept going): ${JSON.stringify(saved.data)}`)
      }
    }
    // Small progressive-overload drift for the next time this exercise shows up.
    weightByExercise.set(execution.id, baseWeight + 1.25)
  }

  if (opts.leaveOpen) {
    return { sessionId, nextPrescriptionId: null }
  }

  const complete = await callApi(account.cookie, 'POST', `/api/training/sessions/${sessionId}/complete`, {
    completion_request_id: crypto.randomUUID(),
  })
  if (!complete.ok) {
    // A too-low completeness can legitimately fail the completion gate —
    // that is fine for the intermittent persona; log and move on.
    console.warn(`[${account.label}] complete skipped (${viewDate}): ${JSON.stringify(complete.data)}`)
    return { sessionId, nextPrescriptionId: null }
  }
  const completeData = (complete.data.data ?? {}) as { next_prescription_id?: string | null }
  return { sessionId, nextPrescriptionId: completeData.next_prescription_id ?? null }
}

/**
 * Rewrites a session's real (script-run-time) timestamps to a chosen
 * historical day with plausible spacing, since start/complete always stamp
 * now(). Sets are spread a few minutes apart; started_at/completed_at bracket
 * them. workout_logs mirrors the same window. Uses the service-role key —
 * this is the one place this script writes tables directly, and only to
 * rows already owned by the account it just created.
 */
async function backdateSession(sessionId: string, day: Date) {
  const { data: sets, error: setsError } = await admin
    .from('set_executions')
    .select('id')
    .eq('workout_session_id', sessionId)
    .eq('status', 'completed')
    .order('set_index')
  if (setsError) throw setsError

  let cursor = new Date(day)
  for (const set of sets ?? []) {
    cursor = new Date(cursor.getTime() + (2 + Math.random() * 4) * 60_000)
    const { error } = await admin.from('set_executions').update({ completed_at: isoOf(cursor) }).eq('id', set.id)
    if (error) throw error
  }
  const startedAt = new Date(day.getTime() - 60_000)
  const completedAt = new Date(cursor.getTime() + 60_000)

  const { error: sessionError } = await admin
    .from('workout_sessions')
    .update({ started_at: isoOf(startedAt), completed_at: isoOf(completedAt), performed_at: isoOf(startedAt) })
    .eq('id', sessionId)
  if (sessionError) throw sessionError

  const { error: logError } = await admin
    .from('workout_logs')
    .update({ created_at: isoOf(startedAt) })
    .eq('method_workout_session_id', sessionId)
  if (logError) throw logError
}

/** Leaves started_at far in the past without ever completing — B5's banner + D1's shape. */
async function backdateStaleOpenSession(sessionId: string, startedDaysAgo: number) {
  const { error } = await admin
    .from('workout_sessions')
    .update({ started_at: isoOf(daysAgo(startedDaysAgo, 20, 0)) })
    .eq('id', sessionId)
  if (error) throw error
}

// --- meals / body metrics / recovery ------------------------------------------

interface FoodSeed { name: string; weight_g: number; kcal: number; protein_g: number; carb_g: number; fat_g: number }
const BREAKFAST: FoodSeed[] = [
  { name: '燕麦牛奶', weight_g: 300, kcal: 260, protein_g: 12, carb_g: 40, fat_g: 6 },
  { name: '水煮蛋', weight_g: 100, kcal: 155, protein_g: 13, carb_g: 1, fat_g: 11 },
]
const LUNCH: FoodSeed[] = [
  { name: '米饭', weight_g: 200, kcal: 232, protein_g: 4.4, carb_g: 51, fat_g: 0.5 },
  { name: '鸡胸肉', weight_g: 150, kcal: 248, protein_g: 46, carb_g: 0, fat_g: 5.4 },
  { name: '清炒时蔬', weight_g: 150, kcal: 90, protein_g: 3, carb_g: 10, fat_g: 4 },
]
const DINNER: FoodSeed[] = [
  { name: '三文鱼', weight_g: 150, kcal: 310, protein_g: 30, carb_g: 0, fat_g: 20 },
  { name: '藜麦沙拉', weight_g: 200, kcal: 220, protein_g: 8, carb_g: 38, fat_g: 4 },
]

async function logMeal(account: TestAccount, date: string, mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack', items: FoodSeed[]) {
  const result = await callApi(account.cookie, 'POST', '/api/nutrition/food-log', {
    request_id: crypto.randomUUID(),
    date,
    meal_type: mealType,
    items: items.map((item) => ({
      food_id: null,
      food_name_raw: item.name,
      food_name_resolved: item.name,
      weight_g: item.weight_g,
      per100g: null,
      resolution_source: 'user_override',
      source_ref_id: null,
      user_confirmed: true,
      fallback: {
        calories_kcal: item.kcal,
        protein_g: item.protein_g,
        carbs_g: item.carb_g,
        fat_g: item.fat_g,
      },
    })),
  })
  if (!result.ok) console.warn(`[${account.label}] meal log failed (${date} ${mealType}): ${JSON.stringify(result.data)}`)
}

/** /api/body-metrics always stamps today; backdate the row's date afterward. */
async function logBodyMetric(account: TestAccount, weightKg: number, day: Date) {
  const result = await callApi(account.cookie, 'POST', '/api/body-metrics', {
    request_id: crypto.randomUUID(),
    time_zone: TIME_ZONE,
    metric: { weight_kg: weightKg },
  })
  if (!result.ok) {
    console.warn(`[${account.label}] body metric failed: ${JSON.stringify(result.data)}`)
    return
  }
  const { error } = await admin
    .from('body_metrics')
    .update({ date: dateKey(day), created_at: isoOf(day) })
    .eq('user_id', account.userId)
    .eq('date', dateKey(new Date()))
  if (error) console.warn(`[${account.label}] body metric backdate failed: ${error.message}`)
}

async function logRecoveryCheckin(account: TestAccount, date: string, sleep: number, postWorkout: number) {
  const result = await callApi(account.cookie, 'POST', '/api/recovery/checkin', {
    date,
    sleep_quality: sleep,
    post_workout_recovery: postWorkout,
  })
  if (!result.ok) console.warn(`[${account.label}] recovery checkin failed (${date}): ${JSON.stringify(result.data)}`)
}

// --- personas -------------------------------------------------------------

async function seedModelUser(account: TestAccount) {
  await onboardAndJoinMethod(account, { weightKg: 78, heightCm: 178 })
  let prescriptionId = await getFirstPrescriptionId(account.userId)
  const weights = new Map<string, number>()

  const totalDays = 28
  for (let daysBack = totalDays; daysBack >= 0; daysBack -= 2) {
    const day = daysAgo(daysBack)
    const viewDate = dateKey(day)

    const { sessionId, nextPrescriptionId } = await runTrainingDay(account, prescriptionId, viewDate, weights, { completeness: 1 })
    await backdateSession(sessionId, day)
    if (nextPrescriptionId) prescriptionId = nextPrescriptionId

    await logMeal(account, viewDate, 'breakfast', BREAKFAST)
    await logMeal(account, viewDate, 'lunch', LUNCH)
    await logMeal(account, viewDate, 'dinner', DINNER)
    await logRecoveryCheckin(account, viewDate, 4, 4)

    if (daysBack % 7 === 0) await logBodyMetric(account, 78 - daysBack * 0.03, day)
    console.log(`[${account.label}] day -${daysBack} done`)
  }
}

async function seedIntermittentUser(account: TestAccount) {
  await onboardAndJoinMethod(account, { weightKg: 68, heightCm: 165 })
  let prescriptionId = await getFirstPrescriptionId(account.userId)
  const weights = new Map<string, number>()

  // A handful of real, completed days spread over 3 weeks, with a couple of
  // low-completeness ones (record_completeness = partial).
  const trainingDays = [21, 16, 9, 4]
  for (const daysBack of trainingDays) {
    const day = daysAgo(daysBack)
    const completeness = daysBack === 16 ? 0.5 : 1
    const { sessionId, nextPrescriptionId } = await runTrainingDay(account, prescriptionId, dateKey(day), weights, { completeness })
    await backdateSession(sessionId, day)
    if (nextPrescriptionId) prescriptionId = nextPrescriptionId
    console.log(`[${account.label}] training day -${daysBack} done (completeness ${completeness})`)
  }

  // The stale, never-finished session — B5's banner, D1's shape.
  const stale = await runTrainingDay(account, prescriptionId, dateKey(new Date()), weights, { completeness: 0.3, leaveOpen: true })
  await backdateStaleOpenSession(stale.sessionId, 13)
  console.log(`[${account.label}] left one session started 13 days ago, unfinished`)

  // Meals: some days only breakfast, one day fully logged, several days nothing.
  await logMeal(account, dateKey(daysAgo(2)), 'breakfast', BREAKFAST)
  await logMeal(account, dateKey(daysAgo(5)), 'breakfast', BREAKFAST)
  await logMeal(account, dateKey(daysAgo(5)), 'lunch', LUNCH)
  await logMeal(account, dateKey(daysAgo(5)), 'dinner', DINNER)
  await logRecoveryCheckin(account, dateKey(daysAgo(9)), 2, 2) // 恢复差 (S5)
}

async function seedNewUser(account: TestAccount) {
  await onboardAndJoinMethod(account, { weightKg: 60, heightCm: 160 })
  // Deliberately nothing else: insufficient/empty states (S6-style, food board
  // all "还没记", weekly report with 0 days).
}

// --- main -------------------------------------------------------------------

async function main() {
  const accounts: Array<{ label: string; email: string; seed: (a: TestAccount) => Promise<void> }> = [
    { label: 'MODEL', email: 'pawside-test-model@example.test', seed: seedModelUser },
    { label: 'INTERMITTENT', email: 'pawside-test-intermittent@example.test', seed: seedIntermittentUser },
    { label: 'NEW', email: 'pawside-test-new@example.test', seed: seedNewUser },
  ]
  const password = `Pawside-${crypto.randomUUID().slice(0, 8)}!`
  const created: TestAccount[] = []

  for (const spec of accounts) {
    console.log(`\n=== ${spec.label}: ${spec.email} ===`)
    const account = await createTestUser(spec.label, spec.email, password)
    created.push(account)
    await spec.seed(account)
  }

  console.log('\n\n================ DONE ================')
  console.log('Accounts (same password for all three, shown once):')
  for (const account of created) {
    console.log(`  ${account.label.padEnd(14)} ${account.email}  (user_id=${account.userId})`)
  }
  console.log(`  password: ${password}`)
  console.log('\nTo remove these test accounts later, run in the SQL editor:')
  console.log(
    `  delete from auth.users where email in (${created.map((a) => `'${a.email}'`).join(', ')});`,
  )
  console.log('(every table here cascades from user_id, so this removes all seeded rows.)')
}

main().catch((error) => {
  console.error('\nSeed run failed:', error)
  process.exit(1)
})
