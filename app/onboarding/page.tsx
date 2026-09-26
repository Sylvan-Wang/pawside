'use client'

import type {
  EquipmentAccess,
  PreferredSessionMinutes,
  PushupCapacity,
  TrainingExperience,
} from '@/lib/contracts/onboarding'
import {
  dailyCalorieTargetBounds,
  weeklyWorkoutTargetBounds,
} from '@/lib/contracts/onboarding'
import { computeMacroTargets } from '@/lib/nutrition/macro-targets'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

const goals = [
  { value: 'lose_fat', label: '减脂' },
  { value: 'gain_muscle', label: '增肌' },
  { value: 'maintain', label: '保持' },
] as const

const genders = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
] as const

const experiences: Array<{ value: TrainingExperience; label: string; note: string }> = [
  { value: 'new_to_structured', label: '刚开始', note: '还没有稳定执行过训练计划' },
  { value: 'some_experience', label: '有一些经验', note: '练过一段时间，但不总是连续' },
  { value: 'consistent', label: '稳定训练', note: '近期持续按计划训练' },
]

const pushupOptions: Array<{ value: PushupCapacity; label: string }> = [
  { value: 'not_yet', label: '暂时不能' },
  { value: 'one_to_five', label: '1–5 次' },
  { value: 'six_to_fifteen', label: '6–15 次' },
  { value: 'sixteen_plus', label: '16 次以上' },
  { value: 'unsure', label: '不确定' },
]

const equipmentOptions: Array<{ value: EquipmentAccess; label: string; note: string }> = [
  { value: 'full_gym', label: '完整健身房', note: '杠铃、哑铃、绳索和常见器械' },
  { value: 'basic_equipment', label: '基础器械', note: '哑铃、弹力带或少量器械' },
  { value: 'home_bodyweight', label: '居家 / 徒手', note: '目前没有完整训练器械' },
]

const sessionOptions: PreferredSessionMinutes[] = [30, 45, 60, 90]

/**
 * Quick-pick values for the weekly training target. Source: Product Patch §3.1
 * (weekly training target is a Target-layer input) and §2 Layer 1.
 * These are affordances, not a rule — the contract bound is what validates.
 */
const WEEKLY_TARGET_OPTIONS = [2, 3, 4, 5] as const

export default function OnboardingPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    goal: '' as typeof goals[number]['value'] | '',
    gender: '' as typeof genders[number]['value'] | '',
    height_cm: '',
    weight_kg: '',
    /**
     * Product Patch §4: the user sets the calorie target; the three macro
     * recommendations are derived, never hand-filled (Product Patch §4.1).
     * Held as strings so "not set" stays distinguishable from 0 (Guardrail §12).
     */
    daily_calorie_target: '',
    weekly_workout_target: '',
    training_experience: '' as TrainingExperience | '',
    pushup_capacity: '' as PushupCapacity | '',
    equipment_access: '' as EquipmentAccess | '',
    preferred_session_minutes: 60 as PreferredSessionMinutes,
  })
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)

  const LB_TO_KG = 0.453592

  useEffect(() => {
    let active = true

    async function loadExistingSettings() {
      try {
        const response = await fetch('/api/onboarding', { cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result?.error?.message || '暂时无法读取现有设置')
        if (!active) return

        const profile = result.data?.profile
        const capability = result.data?.capability_profile
        const unit: 'kg' | 'lb' = profile?.weight_unit === 'lb' ? 'lb' : 'kg'
        const weightKg = Number(profile?.weight_kg)
        setWeightUnit(unit)
        setForm((current) => ({
          goal: profile?.goal || current.goal,
          gender: profile?.gender || current.gender,
          height_cm: profile?.height_cm == null ? current.height_cm : String(profile.height_cm),
          weight_kg: Number.isFinite(weightKg) && weightKg > 0
            ? String(unit === 'lb' ? Number((weightKg / LB_TO_KG).toFixed(1)) : weightKg)
            : current.weight_kg,
          daily_calorie_target: profile?.daily_calorie_target == null
            ? current.daily_calorie_target
            : String(profile.daily_calorie_target),
          weekly_workout_target: profile?.weekly_workout_target == null
            ? current.weekly_workout_target
            : String(profile.weekly_workout_target),
          training_experience: capability?.training_experience || current.training_experience,
          pushup_capacity: capability?.pushup_capacity || current.pushup_capacity,
          equipment_access: capability?.equipment_access || current.equipment_access,
          preferred_session_minutes: capability?.preferred_session_minutes || current.preferred_session_minutes,
        }))
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : '暂时无法读取现有设置')
      } finally {
        if (active) setInitialLoading(false)
      }
    }

    void loadExistingSettings()
    return () => { active = false }
  }, [])

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  /** Body weight in kg, resolved from current input (same conversion used on submit). */
  const weightKgForTargets = useMemo(() => {
    const raw = Number(form.weight_kg)
    if (!Number.isFinite(raw) || raw <= 0) return null
    return weightUnit === 'lb' ? raw * LB_TO_KG : raw
  }, [form.weight_kg, weightUnit])

  const calorieTargetForPreview = useMemo(() => {
    if (form.daily_calorie_target.trim() === '') return null
    const parsed = Number(form.daily_calorie_target)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }, [form.daily_calorie_target])

  /**
   * Derived macro recommendation. Single deterministic source
   * (`lib/nutrition/macro-targets.ts`) — never recomputed here (Guardrail §5).
   */
  const macroPreview = useMemo(
    () => computeMacroTargets({
      dailyCalorieTargetKcal: calorieTargetForPreview as number | null,
      weightKg: weightKgForTargets as number | null,
    }),
    [calorieTargetForPreview, weightKgForTargets],
  )

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')

    if (!form.goal || !form.gender) return setError('请填写基础信息')
    if (Number(form.height_cm) <= 0 || Number(form.weight_kg) <= 0) {
      return setError('身高体重须大于 0')
    }
    if (!form.training_experience || !form.pushup_capacity || !form.equipment_access) {
      return setError('请完成轻量能力画像')
    }

    // Target layer (Product Patch §4). Blank is allowed and stays null, but an
    // out-of-range value must be corrected rather than silently coerced (§2.2).
    const calorieTarget = form.daily_calorie_target.trim() === ''
      ? null
      : Number(form.daily_calorie_target)
    if (
      calorieTarget !== null &&
      (!Number.isFinite(calorieTarget) ||
        calorieTarget < dailyCalorieTargetBounds.min ||
        calorieTarget > dailyCalorieTargetBounds.max)
    ) {
      return setError(
        `每日热量目标须在 ${dailyCalorieTargetBounds.min}–${dailyCalorieTargetBounds.max} kcal 之间`,
      )
    }

    const weeklyTarget = form.weekly_workout_target.trim() === ''
      ? null
      : Number(form.weekly_workout_target)
    if (
      weeklyTarget !== null &&
      (!Number.isFinite(weeklyTarget) ||
        weeklyTarget < weeklyWorkoutTargetBounds.min ||
        weeklyTarget > weeklyWorkoutTargetBounds.max)
    ) {
      return setError(
        `每周训练目标须在 ${weeklyWorkoutTargetBounds.min}–${weeklyWorkoutTargetBounds.max} 次之间`,
      )
    }

    // Source: AI Patch §12.2 — an incompatible calorie target must surface as
    // `needs_review` instead of being forced into a macro split.
    if (calorieTarget !== null && macroPreview.status === 'needs_review') {
      return setError('当前热量目标过低，无法生成合理的三大营养素参考，请调整热量目标')
    }

    setLoading(true)
    try {
      const rawWeight = Number(form.weight_kg)
      const weightKg = weightUnit === 'lb' ? rawWeight * LB_TO_KG : rawWeight
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: form.goal,
          gender: form.gender,
          height_cm: Number(form.height_cm),
          reference_weight_kg: weightKg,
          weight_unit: weightUnit,
          daily_calorie_target: calorieTarget,
          weekly_workout_target: weeklyTarget,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          capability_profile: {
            training_experience: form.training_experience,
            pushup_capacity: form.pushup_capacity,
            equipment_access: form.equipment_access,
            preferred_session_minutes: form.preferred_session_minutes,
          },
          join_method: true,
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error?.message || result?.message || '保存失败')
      }

      if (typeof window !== 'undefined') {
        sessionStorage.setItem('pawside_setup_notice', result?.message || '基础设置已保存。')
      }
      router.push('/home')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <header className="rounded-2xl bg-black p-5 text-white">
        <p className="text-xs text-white/60">Pawside 基础设置</p>
        <h1 className="mt-2 text-xl font-semibold">了解你现在的起点</h1>
        <p className="mt-2 text-sm leading-6 text-white/70">
          这些答案只用于缩小初始训练范围。第一次训练仍会通过实际表现重新找重量。
        </p>
      </header>

      {initialLoading && (
        <p className="mt-4 rounded-2xl bg-white p-4 text-sm text-gray-500">正在读取现有设置…</p>
      )}

      <form
        onSubmit={handleSubmit}
        aria-busy={initialLoading}
        className={`mt-4 space-y-4 ${initialLoading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <section className="rounded-2xl bg-white p-4">
          <div className="mb-4">
            <p className="text-xs text-gray-400">01</p>
            <h2 className="mt-1 font-semibold text-gray-900">基础信息</h2>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">目标</label>
            <div className="flex gap-3">
              {goals.map((goal) => (
                <button
                  key={goal.value}
                  type="button"
                  onClick={() => set('goal', goal.value)}
                  className={form.goal === goal.value
                    ? 'flex-1 rounded-xl border border-black bg-black py-2.5 text-sm text-white'
                    : 'flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600'
                  }
                >
                  {goal.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">性别</label>
            <div className="flex gap-3">
              {genders.map((gender) => (
                <button
                  key={gender.value}
                  type="button"
                  onClick={() => set('gender', gender.value)}
                  className={form.gender === gender.value
                    ? 'flex-1 rounded-xl border border-black bg-black py-2.5 text-sm text-white'
                    : 'flex-1 rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600'
                  }
                >
                  {gender.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="height" className="mb-1 block text-sm text-gray-600">身高（cm）</label>
              <input
                id="height"
                type="number"
                value={form.height_cm}
                onChange={(event) => set('height_cm', event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-gray-400"
                placeholder="170"
                min="1"
                required
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="weight" className="text-sm text-gray-600">体重</label>
                <div className="flex overflow-hidden rounded-lg border border-gray-200">
                  {(['kg', 'lb'] as const).map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => setWeightUnit(unit)}
                      className={weightUnit === unit
                        ? 'bg-black px-2.5 py-0.5 text-xs text-white'
                        : 'px-2.5 py-0.5 text-xs text-gray-500'
                      }
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>
              <input
                id="weight"
                type="number"
                value={form.weight_kg}
                onChange={(event) => set('weight_kg', event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-gray-400"
                placeholder={weightUnit === 'kg' ? '60' : '132'}
                min="1"
                step="0.1"
                required
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4">
          <div className="mb-4">
            <p className="text-xs text-gray-400">02</p>
            <h2 className="mt-1 font-semibold text-gray-900">目标设置</h2>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              热量目标由你自己决定。蛋白质、碳水和脂肪是系统参考值，不是强制限制。
            </p>
          </div>

          <div>
            <label htmlFor="calorie-target" className="mb-1 block text-sm font-medium text-gray-700">
              每日热量目标（kcal）
            </label>
            <input
              id="calorie-target"
              type="number"
              inputMode="numeric"
              value={form.daily_calorie_target}
              onChange={(event) => set('daily_calorie_target', event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm outline-none focus:border-gray-400"
              placeholder="例如 1800"
              min={dailyCalorieTargetBounds.min}
              max={dailyCalorieTargetBounds.max}
            />
            <p className="mt-1 text-xs leading-5 text-gray-400">留空表示暂不设置，之后可在设置中补充。</p>
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">每周训练目标</label>
            <div className="flex flex-wrap gap-2">
              {WEEKLY_TARGET_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => set('weekly_workout_target', String(option))}
                  className={form.weekly_workout_target === String(option)
                    ? 'rounded-xl border border-black bg-black px-4 py-2.5 text-sm text-white'
                    : 'rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600'
                  }
                >
                  {option} 次
                </button>
              ))}
              <button
                type="button"
                onClick={() => set('weekly_workout_target', '')}
                className={form.weekly_workout_target === ''
                  ? 'rounded-xl border border-black bg-black px-4 py-2.5 text-sm text-white'
                  : 'rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600'
                }
              >
                暂不设置
              </button>
            </div>
          </div>

          {/* Derived recommendation. Product Patch §4.1 / AC-P02: labelled 系统建议. */}
          {calorieTargetForPreview !== null && (
            <div className="mt-5 rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-400">每日营养参考</p>

              <div className="mt-2 space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-gray-700">热量</span>
                  <span className="text-sm text-gray-900">
                    {Math.round(calorieTargetForPreview)} kcal
                    <span className="ml-2 text-xs text-gray-400">你的目标</span>
                  </span>
                </div>

                {macroPreview.status === 'ok' && macroPreview.recommended ? (
                  <>
                    {([
                      ['蛋白质', macroPreview.recommended.protein_g],
                      ['碳水', macroPreview.recommended.carb_g],
                      ['脂肪', macroPreview.recommended.fat_g],
                    ] as const).map(([label, value]) => (
                      <div key={label} className="flex items-baseline justify-between">
                        <span className="text-sm text-gray-700">{label}</span>
                        <span className="text-sm text-gray-900">
                          {value} g
                          <span className="ml-2 text-xs text-gray-400">系统建议</span>
                        </span>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-xs leading-5 text-gray-500">
                    {macroPreview.calculationBasis.reason === 'missing_weight'
                      ? '填写体重后即可生成三大营养素参考。'
                      : '当前热量目标无法生成合理的三大营养素参考，请调整热量目标或先填写体重。'}
                  </p>
                )}
              </div>

              {macroPreview.status === 'ok' && (
                <p className="mt-2 text-xs leading-5 text-gray-400">
                  Pawside 参考运动营养研究，为你生成上述参考值；它不是医学标准，也不代替你的判断。
                </p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-4">
          <div className="mb-4">
            <p className="text-xs text-gray-400">03</p>
            <h2 className="mt-1 font-semibold text-gray-900">轻量能力画像</h2>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              不做考试，也不会把俯卧撑次数直接换算成卧推重量。
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-gray-700">你最近的训练状态</legend>
            <div className="mt-2 space-y-2">
              {experiences.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => set('training_experience', option.value)}
                  className={form.training_experience === option.value
                    ? 'w-full rounded-xl border border-black bg-black px-4 py-3 text-left text-white'
                    : 'w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-gray-700'
                  }
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className={form.training_experience === option.value
                    ? 'mt-0.5 block text-xs text-white/60'
                    : 'mt-0.5 block text-xs text-gray-400'
                  }>
                    {option.note}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-gray-700">标准俯卧撑大约能做</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {pushupOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => set('pushup_capacity', option.value)}
                  className={form.pushup_capacity === option.value
                    ? 'rounded-xl border border-black bg-black px-3 py-2.5 text-sm text-white'
                    : 'rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-gray-700">你通常在哪里训练</legend>
            <div className="mt-2 space-y-2">
              {equipmentOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => set('equipment_access', option.value)}
                  className={form.equipment_access === option.value
                    ? 'w-full rounded-xl border border-black bg-black px-4 py-3 text-left text-white'
                    : 'w-full rounded-xl border border-gray-200 px-4 py-3 text-left text-gray-700'
                  }
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className={form.equipment_access === option.value
                    ? 'mt-0.5 block text-xs text-white/60'
                    : 'mt-0.5 block text-xs text-gray-400'
                  }>
                    {option.note}
                  </span>
                </button>
              ))}
            </div>
            {form.equipment_access && form.equipment_access !== 'full_gym' && (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                当前三分化包含杠铃、绳索与器械动作。基础资料仍会保存，但在替代动作确认前不会自动启用方法。
              </p>
            )}
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-gray-700">单次训练通常可安排</legend>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {sessionOptions.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => set('preferred_session_minutes', minutes)}
                  className={form.preferred_session_minutes === minutes
                    ? 'rounded-xl border border-black bg-black py-2.5 text-sm text-white'
                    : 'rounded-xl border border-gray-200 py-2.5 text-sm text-gray-600'
                  }
                >
                  {minutes} 分
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-sm font-medium text-gray-900">接下来会发生什么</p>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            如果三分化已经发布且器械条件匹配，系统会固定当前方法版本，从第 1 轮「推」开始。否则只保存设置，不会伪造训练计划。
          </p>
        </section>

        {error && <p className="px-1 text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading || initialLoading}
          className="w-full rounded-xl bg-black py-3.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {initialLoading ? '正在读取…' : loading ? '正在保存…' : '保存设置'}
        </button>
      </form>
    </div>
  )
}
