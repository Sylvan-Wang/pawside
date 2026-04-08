'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const goals = ['减脂', '增肌', '保持'] as const
const genders = ['男', '女'] as const

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()
  const [form, setForm] = useState({
    goal: '' as typeof goals[number] | '',
    gender: '' as typeof genders[number] | '',
    height_cm: '',
    weight_kg: '',
    weekly_workout_target: '',
    daily_calorie_target: '',
  })
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const LB_TO_KG = 0.453592

  function set(key: string, value: string) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.goal || !form.gender) return setError('请填写必要信息')
    if (Number(form.height_cm) <= 0 || Number(form.weight_kg) <= 0) return setError('身高体重须大于 0')
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登录')
      const rawWeight = Number(form.weight_kg)
      const weightKg = weightUnit === 'lb' ? rawWeight * LB_TO_KG : rawWeight
      const { error } = await supabase.from('user_profiles').update({
        goal: form.goal,
        gender: form.gender,
        height_cm: Number(form.height_cm),
        weight_kg: weightKg,
        weight_unit: weightUnit,
        weekly_workout_target: Number(form.weekly_workout_target) || 3,
        daily_calorie_target: Number(form.daily_calorie_target) || 2000,
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id)
      if (error) throw error
      router.push('/home')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white px-6 py-10">
      <h1 className="text-xl font-bold text-gray-900 mb-1">设置你的健身目标</h1>
      <p className="text-gray-400 text-sm mb-8">只需填写一次，之后随时可修改</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">目标</label>
          <div className="flex gap-3">
            {goals.map(g => (
              <button key={g} type="button" onClick={() => set('goal', g)}
                className={`flex-1 py-2.5 rounded-xl text-sm border transition-colors
                  ${form.goal === g ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                {g}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">性别</label>
          <div className="flex gap-3">
            {genders.map(g => (
              <button key={g} type="button" onClick={() => set('gender', g)}
                className={`flex-1 py-2.5 rounded-xl text-sm border transition-colors
                  ${form.gender === g ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">身高（cm）</label>
            <input type="number" value={form.height_cm} onChange={e => set('height_cm', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-gray-400"
              placeholder="170" min="1" required />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-gray-600">体重</label>
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                {(['kg', 'lb'] as const).map(u => (
                  <button key={u} type="button" onClick={() => setWeightUnit(u)}
                    className={`px-2.5 py-0.5 text-xs transition-colors ${weightUnit === u ? 'bg-black text-white' : 'text-gray-500'}`}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <input type="number" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-3 text-sm outline-none focus:border-gray-400"
              placeholder={weightUnit === 'kg' ? '60' : '132'} min="1" step="0.1" required />
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">每周训练目标（次）</label>
          <input type="number" value={form.weekly_workout_target} onChange={e => set('weekly_workout_target', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder="3" min="0" />
        </div>

        <div>
          <label className="block text-sm text-gray-600 mb-1">每日热量目标（kcal）</label>
          <input type="number" value={form.daily_calorie_target} onChange={e => set('daily_calorie_target', e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder="2000" min="0" />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button type="submit" disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
          {loading ? '加载中…' : '完成设置'}
        </button>
      </form>
    </div>
  )
}
