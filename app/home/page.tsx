'use client'
import { splitLabel } from '@/lib/split-labels'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import BottomNav from '@/components/BottomNav'
import AppTour from '@/components/AppTour'
import { CatNote } from '@/components/CatMascot'
import CoachCard, { type CoachCardState } from '@/components/CoachCard'
import { getWeekStartKey, today } from '@/lib/utils'
import { writeTodayTrainingCache } from '@/lib/training-navigation-cache'
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { translate, type MessageKey } from '@/lib/i18n'
import { useLocale } from '@/lib/i18n/use-locale'

interface Profile {
  goal: string
  weekly_workout_target: number | null
  daily_calorie_target: number | null
  weight_kg: number
  onboarding_completed: boolean
}

/**
 * Product §26: Home is "today's console". It renders the daily nutrition row
 * from the same deterministic source the Daily Log uses, so Home and the Log can
 * never disagree (Guardrail §5).
 */
interface DashboardNutritionRow {
  key: string
  label: string
  consumed: number | null
  target: number | null
  remaining: number | null
  unit: string
}

interface RecoveryPromptState {
  should_prompt: boolean
  checkin: { checkin_date: string } | null
}

interface MethodContext {
  current_cycle_number: number
  next_split_key: string
  current_state: 'ready' | 'recovery_check' | 'rest' | 'session_in_progress'
  method: { name: string; version: string } | null
}

interface MethodAvailability {
  status: 'active' | 'available' | 'unavailable'
  reason: 'NOT_ENROLLED' | 'ONBOARDING_INCOMPLETE' | 'CAPABILITY_PROFILE_MISSING' | 'EQUIPMENT_REVIEW_REQUIRED' | 'METHOD_NOT_READY' | null
  message: string | null
}


/** Display-only rounding. Persisted values stay unrounded (AI Patch §31). */
function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export default function HomePage() {
  const router = useRouter()
  const supabase = createClient()
  const [locale] = useLocale()
  const t = useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  )
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [methodContext, setMethodContext] = useState<MethodContext | null>(null)
  const [methodAvailability, setMethodAvailability] = useState<MethodAvailability | null>(null)
  const [methodLoading, setMethodLoading] = useState(true)
  const [methodActivating, setMethodActivating] = useState(false)
  const [methodMessage, setMethodMessage] = useState<string | null>(null)
  const [setupNotice, setSetupNotice] = useState('')
  const [todayWorkouts, setTodayWorkouts] = useState<{ type: string; duration_minutes: number }[]>([])
  const [todayMealCount, setTodayMealCount] = useState(0)
  const [weeklyDone, setWeeklyDone] = useState(0)
  const [weightData, setWeightData] = useState<{ date: string; weight: number }[]>([])
  const [currentWeight, setCurrentWeight] = useState<number | null>(null)
  const [aiSummary, setAiSummary] = useState<string | null>(null)
  // B4: the first evidence/action, so the Home card matches Appendix A's
  // S1–S5 shape (headline + one bullet + one action), not just a headline.
  const [aiFirstEvidence, setAiFirstEvidence] = useState<string | null>(null)
  const [aiFirstAction, setAiFirstAction] = useState<string | null>(null)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [aiRetrying, setAiRetrying] = useState(false)
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null)
  const [nutritionRows, setNutritionRows] = useState<DashboardNutritionRow[]>([])
  const [nutritionLoading, setNutritionLoading] = useState(true)
  const [recoveryPrompt, setRecoveryPrompt] = useState<RecoveryPromptState | null>(null)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoverySleep, setRecoverySleep] = useState<number | null>(null)
  const [recoveryPostWorkout, setRecoveryPostWorkout] = useState<number | null>(null)
  const [recoverySaving, setRecoverySaving] = useState(false)
  const [hasEverTrained, setHasEverTrained] = useState(false)

  const load = useCallback(async () => {
    // getSession reads from localStorage — no network call
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) { router.push('/auth'); return }

    const todayStr = today()
    const weekStart = getWeekStartKey(todayStr)
    const [profileRes, workoutRes, weekWorkoutRes, metricsRes, anyWorkoutRes] = await Promise.all([
      supabase.from('user_profiles').select('goal,weekly_workout_target,daily_calorie_target,weight_kg,onboarding_completed').eq('id', user.id).single(),
      supabase.from('workout_logs').select('type,duration_minutes').eq('user_id', user.id).eq('date', todayStr),
      supabase.from('workout_logs').select('date').eq('user_id', user.id).gte('date', weekStart),
      supabase.from('body_metrics').select('date,weight_kg').eq('user_id', user.id).order('date', { ascending: false }).limit(14),
      supabase.from('workout_logs').select('date').eq('user_id', user.id).limit(1),
    ])

    const p = profileRes.data
    setProfile(p)
    setTodayWorkouts(workoutRes.data || [])
    setWeeklyDone((weekWorkoutRes.data || []).length)
    // Product §7: with no prior training, the recovery question is optional, so
    // Home needs to know whether to ask it at all.
    setHasEverTrained((anyWorkoutRes.data || []).length > 0)

    const metrics = metricsRes.data || []
    const withWeight = metrics.filter(m => m.weight_kg).reverse()
    setWeightData(withWeight.map(m => ({ date: m.date.slice(5), weight: m.weight_kg })))
    if (withWeight.length > 0) setCurrentWeight(withWeight[withWeight.length - 1].weight_kg)

    setProfileLoading(false)
  }, [router, supabase])

  const loadMethod = useCallback(async () => {
    setMethodLoading(true)
    try {
      const response = await fetch('/api/method/current')
      if (!response.ok) {
        setMethodContext(null)
        setMethodAvailability(null)
        setMethodMessage(t('home.method.loadFailed'))
        return
      }
      const result = await response.json()
      setMethodContext(result.data)
      setMethodAvailability(result.availability ?? null)
      if (result.availability?.message) setMethodMessage(result.availability.message)
    } catch {
      setMethodContext(null)
      setMethodAvailability(null)
      setMethodMessage(t('home.method.loadFailed'))
    } finally {
      setMethodLoading(false)
    }
  }, [t])

  const handleMethodAction = useCallback(async () => {
    if (profileLoading || methodLoading || methodActivating) return
    if (!profile?.onboarding_completed || methodAvailability?.reason === 'ONBOARDING_INCOMPLETE' || methodAvailability?.reason === 'CAPABILITY_PROFILE_MISSING') {
      router.push('/onboarding')
      return
    }
    if (methodAvailability?.reason === 'EQUIPMENT_REVIEW_REQUIRED') {
      router.push('/settings/method')
      return
    }
    if (methodAvailability?.status !== 'available') {
      router.push('/training/method')
      return
    }

    setMethodActivating(true)
    try {
      const response = await fetch('/api/method/enroll', { method: 'POST' })
      const result = await response.json()
      if (!response.ok) {
        const message = result?.error?.message || result?.message || t('home.method.enableFailed')
        setMethodMessage(message)
        if (result?.error?.code === 'ONBOARDING_INCOMPLETE') router.push('/onboarding')
        return
      }
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('pawside_setup_notice', result?.message || t('home.method.enabledNotice'))
      }
      await loadMethod()
      router.push('/training/today')
    } catch {
      setMethodMessage(t('home.method.enableFailedRetry'))
    } finally {
      setMethodActivating(false)
    }
  }, [loadMethod, methodActivating, methodAvailability?.reason, methodAvailability?.status, methodLoading, profile?.onboarding_completed, profileLoading, router, t])

  // Load AI summary — sessionStorage cache so revisiting /home is instant.
  // spec A0-5: Home MUST read ai_status rather than showing the deterministic
  // fallback text as if it were a real AI answer (it previously did not).
  const loadAiSummary = useCallback(async (forceRefresh = false) => {
    const dateKey = today()
    // v5: cache now also carries the first evidence/action (B4).
    const cacheKey = `ai_summary_v5_${dateKey}`

    // Check sessionStorage first (same session, same day) — skipped on retry,
    // since a cached failure would otherwise just be handed back unchanged.
    if (!forceRefresh && typeof window !== 'undefined') {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as {
            summary: string | null; evidence: string | null; action: string | null; available: boolean
          }
          setAiSummary(parsed.summary)
          setAiFirstEvidence(parsed.evidence)
          setAiFirstAction(parsed.action)
          setAiAvailable(parsed.available)
          return
        } catch { /* fall through to refetch */ }
      }
    }

    if (forceRefresh) setAiRetrying(true)
    else setAiSummaryLoading(true)
    try {
      const res = await fetch('/api/ai/daily-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateKey,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        const available = Boolean(data?.ai_status?.available)
        const summary = data.summary || null
        const evidence = (data.insights?.[0] as string | undefined) ?? null
        const action = (data.actions?.[0] as string | undefined) ?? null
        setAiSummary(summary)
        setAiFirstEvidence(evidence)
        setAiFirstAction(action)
        setAiAvailable(available)
        if (summary && typeof window !== 'undefined') {
          sessionStorage.setItem(cacheKey, JSON.stringify({ summary, evidence, action, available }))
        }
      }
    } catch { /* silent */ } finally {
      setAiSummaryLoading(false)
      setAiRetrying(false)
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(load) }, [load])
  useEffect(() => { void Promise.resolve().then(loadMethod) }, [loadMethod])
  useEffect(() => { void Promise.resolve().then(() => loadAiSummary()) }, [loadAiSummary])

  /**
   * Product §26: Home renders today's nutrition from the shared deterministic
   * source, and Product §7 offers the Recovery Check-in once per local day.
   *
   * Real data only — the previous card showed a meal count. Nothing here
   * substitutes a default for an unset target (Product §27).
   */
  const loadTodayFacts = useCallback(async () => {
    const dateKey = today()
    setNutritionLoading(true)
    try {
      const [dailyResponse, recoveryResponse] = await Promise.all([
        fetch(`/api/daily-log?date=${dateKey}&today=${dateKey}&preload=1`, { cache: 'no-store' }),
        fetch(`/api/recovery/checkin?date=${dateKey}`, { cache: 'no-store' }),
      ])

      if (dailyResponse.ok) {
        const payload = await dailyResponse.json()
        setNutritionRows(payload?.data?.dashboard_nutrition ?? [])
        setTodayMealCount(Number(payload?.data?.log?.summary?.meal_count ?? 0))
      }

      if (recoveryResponse.ok) {
        const payload = await recoveryResponse.json()
        setRecoveryPrompt({
          should_prompt: Boolean(payload?.data?.should_prompt),
          checkin: payload?.data?.checkin ?? null,
        })
      }
    } catch (reason) {
      console.error('[home] failed to load today facts', reason)
    } finally {
      setNutritionLoading(false)
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(loadTodayFacts) }, [loadTodayFacts])

  async function submitRecoveryCheckin(skipped = false) {
    const dateKey = today()
    setRecoverySaving(true)
    try {
      const response = await fetch('/api/recovery/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: dateKey,
          sleep_quality: skipped ? null : recoverySleep,
          post_workout_recovery: skipped ? null : recoveryPostWorkout,
          skipped,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error?.message || t('home.recovery.saveFailed'))
      }
      // Product §21: a recovery answer is part of the day's facts, so the
      // displayed daily summary must not keep showing the pre-answer state.
      sessionStorage.removeItem(`ai_review_${dateKey}`)
      sessionStorage.removeItem(`ai_summary_${dateKey}`)
      sessionStorage.removeItem(`ai_review_v3_${dateKey}`)
      sessionStorage.removeItem(`ai_summary_v3_${dateKey}`)
      setRecoveryOpen(false)
      setRecoveryPrompt({ should_prompt: false, checkin: { checkin_date: dateKey } })
      await loadTodayFacts()
      await loadAiSummary()
    } catch (reason) {
      console.error('[home] recovery check-in failed', reason)
    } finally {
      setRecoverySaving(false)
    }
  }

  useEffect(() => {
    router.prefetch('/training/today')
    router.prefetch('/training/method')
  }, [router])
  useEffect(() => {
    if (!methodContext) return
    let active = true

    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    const query = new URLSearchParams({ date: today, time_zone: timeZone })

    void fetch(`/api/training/today?${query}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return
        const payload = await response.json()
        // Minimum P1 §2: the training cache is keyed by Program Day, not by date.
        const splitKey = payload?.data?.program_day?.split_key
        if (active && splitKey) writeTodayTrainingCache(payload.data, splitKey)
      })
      .catch(() => undefined)

    return () => { active = false }
  }, [methodContext])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const notice = sessionStorage.getItem('pawside_setup_notice')
    if (!notice) return
    sessionStorage.removeItem('pawside_setup_notice')
    const frame = window.requestAnimationFrame(() => setSetupNotice(notice))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  // Product §4 / Guardrail §2.2: an unset weekly target must not become a fake 3.
  const weekTarget = profile?.weekly_workout_target ?? null
  const weekPct = weekTarget === null
    ? null
    : Math.min(100, Math.round((weeklyDone / weekTarget) * 100))
  const entryLoading = profileLoading || methodLoading
  // The official method's name is stored in Chinese; English shows the dictionary name for it.
  const methodName = (name: string | null | undefined) =>
    !name || (locale === 'en' && name === translate('zh', 'home.method.defaultName'))
      ? t('home.method.defaultName')
      : name
  // The daily-log API sends Chinese row labels; in English, known rows use the dictionary.
  const nutrientLabel = (row: DashboardNutritionRow) =>
    locale === 'en' && ['calories', 'protein', 'carbs', 'fat'].includes(row.key)
      ? t(`common.nutrients.${row.key}` as MessageKey)
      : row.label
  const methodAvailable = methodAvailability?.status === 'available'
  const methodNeedsSetup = !profile?.onboarding_completed
    || methodAvailability?.reason === 'ONBOARDING_INCOMPLETE'
    || methodAvailability?.reason === 'CAPABILITY_PROFILE_MISSING'
  const methodEquipmentBlocked = methodAvailability?.reason === 'EQUIPMENT_REVIEW_REQUIRED'

  return (
    <div className="pb-20 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-white px-4 py-4 border-b border-gray-100">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-gray-400">{today()}</p>
            <h1 className="text-lg font-bold text-gray-900">{t('home.brand')}</h1>
          </div>
          <div className="flex gap-2">
            <button disabled={entryLoading} onClick={() => {
              if (entryLoading) return
              router.push(
                methodContext
                  ? '/training/today'
                  : profile?.onboarding_completed
                    ? '/workout'
                    : '/onboarding'
              )
            }}
              className="text-xs bg-black text-white px-3 py-1.5 rounded-lg">
              {entryLoading
                ? t('home.loading')
                : methodContext
                ? t('home.startToday')
                : profile?.onboarding_completed
                  ? t('home.logWorkout')
                  : t('home.finishSetup')}
            </button>
            <button onClick={() => router.push('/food')}
              className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg text-gray-700">{t('home.logFood')}</button>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {setupNotice && (
          <div className="rounded-2xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800">
            {setupNotice}
          </div>
        )}
        <div className="bg-black text-white rounded-2xl p-5">
          {methodContext ? (
            <>
              <p className="text-xs text-white/60">{t('home.method.cycle', { name: methodName(methodContext.method?.name), n: methodContext.current_cycle_number })}</p>
              <div className="flex items-end justify-between mt-2">
                <div>
                  <p className="text-xl font-semibold">{t('home.method.next', { split: splitLabel(methodContext.next_split_key, null, locale) })}</p>
                  <p className="text-sm text-white/70 mt-1">{t('home.method.orderNote')}</p>
                </div>
                <button onClick={() => router.push('/training/today')} className="bg-white text-black rounded-xl px-4 py-2 text-sm font-medium">
                  {t('home.startToday')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-white/60">{t('home.method.label')}</p>
              <p className="text-lg font-semibold mt-2">
                {entryLoading
                  ? t('home.method.reading')
                  : methodAvailable
                    ? t('home.method.ready')
                    : methodEquipmentBlocked
                      ? t('home.method.pickOne')
                    : t('home.method.notOpen')}
              </p>
              <p className="text-sm text-white/70 mt-1">
                {entryLoading ? t('home.method.syncing') : (methodMessage ?? t('home.method.pendingMessage'))}
              </p>
              <div className="mt-4 flex items-center gap-3">
                <button
                  disabled={entryLoading || methodActivating}
                  onClick={handleMethodAction}
                  className="bg-white text-black rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-60"
                >
                  {entryLoading
                    ? t('home.loading')
                    : methodActivating
                      ? t('home.method.enabling')
                      : methodNeedsSetup
                        ? t('home.finishSetup')
                        : methodEquipmentBlocked
                          ? t('home.method.choose')
                        : methodAvailable
                          ? t('home.method.enable')
                          : t('home.method.view')}
                </button>
                <button
                  onClick={() => router.push('/training/method')}
                  className="rounded-xl border border-white/20 px-4 py-2 text-sm text-white/80"
                >
                  {t('home.method.preview')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Dashboard cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl p-4">
            <p className="text-xs text-gray-400 mb-1">{t('home.cards.todayTraining')}</p>
            <p className={`text-sm font-semibold ${todayWorkouts.length > 0 ? 'text-black' : 'text-gray-400'}`}>
              {todayWorkouts.length > 0 ? t('home.cards.doneTimes', { n: todayWorkouts.length }) : t('home.cards.notDone')}
            </p>
            {todayWorkouts.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">{todayWorkouts.map(w => w.type).join(t('home.cards.listSeparator'))}</p>
            )}
          </div>
          <div className="bg-white rounded-2xl p-4">
            <p className="text-xs text-gray-400 mb-1">{t('home.cards.todayFood')}</p>
            <p className={`text-sm font-semibold ${todayMealCount > 0 ? 'text-black' : 'text-gray-400'}`}>
              {todayMealCount > 0 ? t('home.cards.mealsLogged', { n: todayMealCount }) : t('home.cards.notLogged')}
            </p>
          </div>
          <div className="bg-white rounded-2xl p-4 col-span-2">
            <p className="text-xs text-gray-400 mb-1">{t('home.cards.week')}</p>
            <p className="text-sm font-semibold">
              {weekTarget === null
                ? t('home.cards.weekCount', { done: weeklyDone })
                : t('home.cards.weekCountOfTarget', { done: weeklyDone, target: weekTarget })}
            </p>
            {weekPct !== null && (
              <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-black rounded-full transition-all" style={{ width: `${weekPct}%` }} />
              </div>
            )}
            {/* Product §27: no fabricated target — prompt to set one instead. */}
            {weekPct === null
              ? <button onClick={() => router.push('/settings')} className="text-xs text-gray-400 mt-1 underline">
                {t('home.cards.setWeeklyTarget')}
              </button>
              : <p className="text-xs text-gray-400 mt-1">{t('home.cards.weekTargetNote')}</p>
            }
          </div>
        </div>

        {/* Today nutrition — Product §26 / §16.2 Daily Dashboard nutrition row */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">{t('home.nutrition.title')}</h2>
            <button onClick={() => router.push(`/history/${today()}`)}
              className="text-xs text-gray-400 underline">{t('home.nutrition.expand')}</button>
          </div>

          {nutritionLoading ? (
            <p className="text-sm text-gray-400">{t('home.loading')}</p>
          ) : nutritionRows.length === 0 ? (
            <CatNote mood="eating" size={88} title={t('home.nutrition.emptyTitle')} hint={t('home.nutrition.emptyHint')} />
          ) : (
            <div className="space-y-2">
              {nutritionRows.map((row) => {
                const digits = row.unit === 'kcal' ? 0 : 1
                if (row.consumed === null) {
                  return (
                    <div key={row.key} className="flex items-baseline justify-between">
                      <span className="text-xs text-gray-500">{nutrientLabel(row)}</span>
                      <span className="text-sm text-gray-400">{t('home.nutrition.incomplete')}</span>
                    </div>
                  )
                }
                const consumed = round(row.consumed, digits)
                if (row.target === null) {
                  // Product §27: show consumed; never a fabricated target.
                  return (
                    <div key={row.key} className="flex items-baseline justify-between">
                      <span className="text-xs text-gray-500">{nutrientLabel(row)}</span>
                      <span className="text-sm text-gray-700">
                        {consumed} {row.unit}
                        <span className="ml-2 text-xs text-gray-400">{t('home.nutrition.noTarget')}</span>
                      </span>
                    </div>
                  )
                }
                // Product §4.2: over-target stays visible as an "over by" note, not clamped.
                const over = (row.remaining ?? 0) < 0
                return (
                  <div key={row.key} className="flex items-baseline justify-between">
                    <span className="text-xs text-gray-500">{nutrientLabel(row)}</span>
                    <span className="text-sm text-gray-700">
                      {consumed}
                      <span className="text-gray-400"> / {round(row.target, digits)} {row.unit}</span>
                      {over && (
                        <span className="ml-2 text-xs text-amber-600">
                          {t('home.nutrition.over', { n: round(Math.abs(row.remaining ?? 0), digits) })}
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
              {nutritionRows.every((row) => row.target === null) && (
                <button onClick={() => router.push('/settings')}
                  className="mt-1 text-xs text-black underline">
                  {t('home.nutrition.setCalorieTarget')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Recovery Check-in prompt — Product §7: max once per local day */}
        {recoveryPrompt?.should_prompt && !recoveryOpen && (
          <div className="bg-white rounded-2xl p-4">
            <h2 className="text-sm font-semibold">{t('home.recovery.title')}</h2>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              {t('home.recovery.intro')}
            </p>
            <button onClick={() => setRecoveryOpen(true)}
              className="mt-3 w-full rounded-xl bg-black py-2.5 text-sm font-medium text-white">
              {t('home.recovery.open')}
            </button>
          </div>
        )}

        {recoveryOpen && (
          <div className="bg-white rounded-2xl p-4">
            <h2 className="text-sm font-semibold">{t('home.recovery.title')}</h2>

            <p className="mt-3 text-xs text-gray-500">{t('home.recovery.sleep')}</p>
            <div className="mt-1.5 flex gap-1.5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" onClick={() => setRecoverySleep(value)}
                  className={recoverySleep === value
                    ? 'flex-1 rounded-lg border border-black bg-black py-2 text-xs text-white'
                    : 'flex-1 rounded-lg border border-gray-200 py-2 text-xs text-gray-600'}>
                  {value}
                </button>
              ))}
            </div>

            {/* Product §7: with no training history the recovery question is optional. */}
            {hasEverTrained && (
              <>
                <p className="mt-3 text-xs text-gray-500">{t('home.recovery.postWorkout')}</p>
                <div className="mt-1.5 flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button key={value} type="button" onClick={() => setRecoveryPostWorkout(value)}
                      className={recoveryPostWorkout === value
                        ? 'flex-1 rounded-lg border border-black bg-black py-2 text-xs text-white'
                        : 'flex-1 rounded-lg border border-gray-200 py-2 text-xs text-gray-600'}>
                      {value}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-3 flex gap-2">
              <button onClick={() => submitRecoveryCheckin(false)} disabled={recoverySaving}
                className="flex-1 rounded-xl bg-black py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {recoverySaving ? t('home.recovery.saving') : t('home.recovery.done')}
              </button>
              <button onClick={() => submitRecoveryCheckin(true)} disabled={recoverySaving}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 disabled:opacity-50">
                {t('home.recovery.skip')}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {t('home.recovery.note')}
            </p>
          </div>
        )}

        {/* Today AI summary */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">{t('home.review.title')}</h2>
            <button onClick={() => router.push(`/history/${today()}`)}
              className="text-xs text-gray-400 underline">{t('home.review.details')}</button>
          </div>
          <CoachCard
            state={(() => {
              if (aiSummaryLoading) return 'loading'
              if (todayMealCount === 0 && todayWorkouts.length === 0) return 'insufficient'
              return aiAvailable ? 'ai' : 'basic'
            })() as CoachCardState}
            headline={aiSummary}
            bullets={aiFirstEvidence ? [aiFirstEvidence] : []}
            actions={aiFirstAction ? [aiFirstAction] : []}
            loadingText={t('home.review.loading')}
            insufficientText={t('home.review.empty')}
            onRetry={() => loadAiSummary(true)}
            retrying={aiRetrying}
          />
        </div>

        {/* Weight trend */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold">{t('home.weight.title')}</h2>
            {currentWeight && <p className="text-sm font-bold">{currentWeight} kg</p>}
          </div>
          {weightData.length >= 2 ? (
            <ResponsiveContainer width="100%" height={80}>
              <LineChart data={weightData}>
                <XAxis dataKey="date" hide />
                <Tooltip
                  formatter={(v: number) => [`${v} kg`, '']}
                  labelFormatter={() => ''}
                  contentStyle={{ fontSize: 12, border: 'none', background: '#f5f5f5', borderRadius: 8 }}
                />
                <Line type="monotone" dataKey="weight" stroke="#000" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-400">{t('home.weight.empty')}</p>
              <button onClick={() => router.push('/body-metrics')} className="mt-2 text-xs text-black underline">
                {t('home.weight.log')}
              </button>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-2xl p-4">
          <h2 className="text-sm font-semibold mb-3">{t('home.quick.title')}</h2>
          <div className="grid grid-cols-3 gap-2">
            {[
              { labelKey: 'home.quick.freeWorkout', href: '/workout', icon: '🏋️' },
              { labelKey: 'home.quick.food', href: '/food', icon: '🥗' },
              { labelKey: 'home.quick.body', href: '/body-metrics', icon: '📏' },
            ].map(({ labelKey, href, icon }) => (
              <Link key={href} href={href} prefetch
                className="flex flex-col items-center rounded-xl border border-gray-100 py-3 text-xs text-gray-600 transition active:scale-[0.98] active:bg-gray-50">
                <span className="text-xl mb-1">{icon}</span>
                {t(labelKey as MessageKey)}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <AppTour ready={!profileLoading && profile?.onboarding_completed === true} />
      <BottomNav />
    </div>
  )
}
