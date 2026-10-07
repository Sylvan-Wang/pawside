'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import BottomNav from '@/components/BottomNav'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import {
  dailyCalorieTargetBounds,
  weeklyWorkoutTargetBounds,
} from '@/lib/contracts/onboarding'
import { clearTrainingNavigationCache } from '@/lib/training-navigation-cache'

const LB_TO_KG = 0.453592

const goalOptions = [
  { value: 'lose_fat', label: '减脂' },
  { value: 'gain_muscle', label: '增肌' },
  { value: 'maintain', label: '保持' },
] as const

const genderOptions = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
] as const

function canonicalGoal(value: string | null): string {
  return ({ '减脂': 'lose_fat', '增肌': 'gain_muscle', '保持': 'maintain' } as Record<string, string>)[value ?? ''] ?? value ?? ''
}

function canonicalGender(value: string | null): string {
  return ({ '男': 'male', '女': 'female' } as Record<string, string>)[value ?? ''] ?? value ?? ''
}

interface Profile {
  email: string
  gender: string
  height_cm: number
  weight_kg: number
  goal: string
  weekly_workout_target: number | null
  daily_calorie_target: number | null
}

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { show, ToastEl } = useToast()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState({ gender: '', height_cm: '', weight_kg: '', goal: '', weekly_workout_target: '', daily_calorie_target: '' })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [accountEmail, setAccountEmail] = useState('')
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg')
  const [isOwner, setIsOwner] = useState(false)

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) { router.push('/auth'); return }
    setAccountEmail(user.email ?? '')
    void Promise.resolve(supabase.rpc('feature_enabled', { p_key: 'owner_console' })).then(({ data: owner }) => setIsOwner(owner === true), () => setIsOwner(false))
    const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single()
    if (data) {
      setProfile(data)
      setForm({
        gender: canonicalGender(data.gender),
        height_cm: String(data.height_cm || ''),
        weight_kg: data.weight_kg == null
          ? ''
          : String(data.weight_unit === 'lb' ? Number(data.weight_kg) / LB_TO_KG : data.weight_kg),
        goal: canonicalGoal(data.goal),
        weekly_workout_target: String(data.weekly_workout_target || ''),
        daily_calorie_target: String(data.daily_calorie_target || ''),
      })
      setWeightUnit(data.weight_unit === 'lb' ? 'lb' : 'kg')
    }
  }, [router, supabase])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  async function handleSave() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登录')

      /*
       * Target layer (Product Patch §4 / §3.1).
       *
       * Previously these two were written as:
       *     Number(form.x) || 3        // weekly
       *     Number(form.x) || 2000     // calories
       * which fabricated a target whenever the field was blank, making
       * "user has not set a target" unrepresentable (Phase 0 baseline §3.2).
       * Blank now persists as NULL, and out-of-range input is rejected rather
       * than silently clamped (Guardrail §2.2).
       *
       * Bounds are tamper guards, not health thresholds: AI Patch §14 /
       * E-NUT-SAFE-001 establish there is no universal calorie floor here.
       */
      const weeklyTarget = form.weekly_workout_target.trim() === ''
        ? null
        : Number(form.weekly_workout_target)
      if (
        weeklyTarget !== null &&
        (!Number.isInteger(weeklyTarget) ||
          weeklyTarget < weeklyWorkoutTargetBounds.min ||
          weeklyTarget > weeklyWorkoutTargetBounds.max)
      ) {
        throw new Error(
          `每周训练目标须为 ${weeklyWorkoutTargetBounds.min}–${weeklyWorkoutTargetBounds.max} 之间的整数`,
        )
      }

      const calorieTarget = form.daily_calorie_target.trim() === ''
        ? null
        : Number(form.daily_calorie_target)
      if (
        calorieTarget !== null &&
        (!Number.isInteger(calorieTarget) ||
          calorieTarget < dailyCalorieTargetBounds.min ||
          calorieTarget > dailyCalorieTargetBounds.max)
      ) {
        throw new Error(
          `每日热量目标须为 ${dailyCalorieTargetBounds.min}–${dailyCalorieTargetBounds.max} 之间的整数`,
        )
      }

      const displayWeight = Number(form.weight_kg)
      const weightKg = weightUnit === 'lb' ? displayWeight * LB_TO_KG : displayWeight
      const response = await fetch('/api/settings/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gender: form.gender,
          height_cm: Number(form.height_cm),
          weight_kg: weightKg,
          goal: form.goal,
          weekly_workout_target: weeklyTarget,
          daily_calorie_target: calorieTarget,
          weight_unit: weightUnit,
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message || '保存失败')
      for (const affectedDate of payload?.data?.affected_dates ?? []) {
        sessionStorage.removeItem(`ai_review_${affectedDate}`)
        sessionStorage.removeItem(`ai_summary_${affectedDate}`)
        sessionStorage.removeItem(`ai_review_v3_${affectedDate}`)
        sessionStorage.removeItem(`ai_summary_v3_${affectedDate}`)
      }
      show('设置完成')
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const response = await fetch('/api/account/export', { cache: 'no-store' })
      if (!response.ok) throw new Error('导出失败，请稍后再试')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pawside_all_data_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      show('导出成功')
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '导出失败', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_email: deleteConfirm }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error?.message ?? '删除失败，请稍后再试')
      clearTrainingNavigationCache()
      router.push('/auth')
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '删除失败', 'error')
      setDeleting(false)
    }
  }

  async function handleLogout() {
    clearTrainingNavigationCache()
    await supabase.auth.signOut()
    router.replace('/auth')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {ToastEl}
      <PageHeader title="设置" />

      <div className="px-4 py-4 space-y-4">
        {/* Profile info */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-sm font-semibold mb-3">个人信息</p>
          {profile?.email && <p className="text-xs text-gray-400 mb-3">{profile.email}</p>}

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">性别</label>
              <div className="flex gap-2">
                {genderOptions.map(g => (
                  <button key={g.value} onClick={() => setForm(f => ({ ...f, gender: g.value }))}
                    className={`flex-1 py-2 rounded-xl text-sm border ${form.gender === g.value ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">身高（cm）</label>
                <input type="number" value={form.height_cm} onChange={e => setForm(f => ({ ...f, height_cm: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="170" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">体重参考值</label>
                <input type="number" step="0.1" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="60" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">体重单位偏好</label>
              <div className="flex gap-2">
                {(['kg', 'lb'] as const).map(u => (
                  <button key={u} type="button" onClick={() => setWeightUnit(u)}
                    className={`flex-1 py-2 rounded-xl text-sm border transition-colors ${weightUnit === u ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Goals */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-sm font-semibold mb-3">健身目标</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">目标</label>
              <div className="flex gap-2">
                {goalOptions.map(g => (
                  <button key={g.value} onClick={() => setForm(f => ({ ...f, goal: g.value }))}
                    className={`flex-1 py-2 rounded-xl text-sm border ${form.goal === g.value ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">每周训练目标（次）</label>
              <input type="number" value={form.weekly_workout_target} onChange={e => setForm(f => ({ ...f, weekly_workout_target: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="3" min="0" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">每日热量目标（kcal）</label>
              <input type="number" value={form.daily_calorie_target} onChange={e => setForm(f => ({ ...f, daily_calorie_target: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="2000" min="0" />
            </div>
          </div>
        </div>

        <button onClick={handleSave} disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
          {loading ? '加载中…' : '保存'}
        </button>

        {/* Actions */}
        <div className="bg-white rounded-2xl overflow-hidden">
          <Link href="/settings/method"
            className="flex w-full items-center justify-between px-4 py-4 text-left text-sm text-gray-700 border-b border-gray-50">
            <span>训练方法</span>
            <span className="text-xs text-gray-400">三分化 / 四分化 ›</span>
          </Link>
          {isOwner && (
            <Link href="/settings/health"
              className="block w-full px-4 py-4 text-left text-sm text-gray-700 border-b border-gray-50">
              数据健康
            </Link>
          )}
          <button onClick={handleExport} disabled={exporting}
            className="w-full px-4 py-4 text-left text-sm text-gray-700 border-b border-gray-50 disabled:opacity-50">
            {exporting ? '导出中…' : '导出我的全部数据'}
          </button>
          {/* Patch B · B2: dropped the standing "每日复盘与建议草稿统一由
              OpenAI 生成" line — moved to 关于 as one plain sentence. */}
          <Link href="/settings/about"
            className="block w-full px-4 py-4 text-left text-sm text-gray-700 border-b border-gray-50">
            关于
          </Link>
          <button onClick={handleLogout}
            className="w-full px-4 py-4 text-left text-sm text-red-500">
            退出登录
          </button>
        </div>

        <button onClick={() => { setDeleteConfirm(''); setDeleteOpen(true) }}
          className="w-full py-3 text-center text-xs text-gray-400 underline">
          删除账号
        </button>
      </div>

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5">
            <p className="text-base font-semibold">删除账号</p>
            <p className="mt-2 text-sm leading-relaxed text-gray-700">
              删除后，你的账号和所有训练、饮食、身体数据、自评和 AI 反馈都会被永久清除，无法恢复。需要留存的话，请先导出。
            </p>
            <p className="mt-3 text-xs text-gray-500">请输入你的账号邮箱（{accountEmail}）确认：</p>
            <input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)}
              autoCapitalize="none" autoCorrect="off" inputMode="email"
              className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none" />
            <div className="mt-4 flex gap-3">
              <button onClick={() => setDeleteOpen(false)} disabled={deleting}
                className="flex-1 rounded-xl bg-gray-100 py-3 text-sm text-gray-700 disabled:opacity-50">取消</button>
              <button onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirm.trim().toLowerCase() !== accountEmail.toLowerCase() || !accountEmail}
                className="flex-1 rounded-xl bg-red-500 py-3 text-sm font-medium text-white disabled:opacity-40">
                {deleting ? '删除中…' : '永久删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
