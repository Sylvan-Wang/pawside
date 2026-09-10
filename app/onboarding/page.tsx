'use client'

import type {
  EquipmentAccess,
  PreferredSessionMinutes,
  PushupCapacity,
  TrainingExperience,
} from '@/lib/contracts/onboarding'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

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

export default function OnboardingPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    goal: '' as typeof goals[number]['value'] | '',
    gender: '' as typeof genders[number]['value'] | '',
    height_cm: '',
    weight_kg: '',
    training_experience: '' as TrainingExperience | '',
    pushup_capacity: '' as PushupCapacity | '',
    equipment_access: '' as EquipmentAccess | '',
    preferred_session_minutes: 60 as PreferredSessionMinutes,
  })
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const LB_TO_KG = 0.453592

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

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

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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
          disabled={loading}
          className="w-full rounded-xl bg-black py-3.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? '正在保存…' : '完成设置'}
        </button>
      </form>
    </div>
  )
}
