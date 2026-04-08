'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BottomNav from '@/components/BottomNav'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'

interface Profile {
  email: string
  gender: string
  height_cm: number
  weight_kg: number
  goal: string
  weekly_workout_target: number
  daily_calorie_target: number
}

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { show, ToastEl } = useToast()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState({ gender: '', height_cm: '', weight_kg: '', goal: '', weekly_workout_target: '', daily_calorie_target: '' })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [preferredModel, setPreferredModel] = useState<'openai' | 'deepseek'>('openai')
  const [savingModel, setSavingModel] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }
    const { data } = await supabase.from('user_profiles').select('*').eq('id', user.id).single()
    if (data) {
      setProfile(data)
      setForm({
        gender: data.gender || '',
        height_cm: String(data.height_cm || ''),
        weight_kg: String(data.weight_kg || ''),
        goal: data.goal || '',
        weekly_workout_target: String(data.weekly_workout_target || ''),
        daily_calorie_target: String(data.daily_calorie_target || ''),
      })
      setPreferredModel(data.preferred_model === 'deepseek' ? 'deepseek' : 'openai')
    }
  }, [router, supabase])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登录')
      const { error } = await supabase.from('user_profiles').update({
        gender: form.gender || null,
        height_cm: form.height_cm ? Number(form.height_cm) : null,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        goal: form.goal || null,
        weekly_workout_target: Number(form.weekly_workout_target) || 3,
        daily_calorie_target: Number(form.daily_calorie_target) || 2000,
        updated_at: new Date().toISOString(),
      }).eq('id', user.id)
      if (error) throw error
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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登录')

      const [wRes, fRes, mRes] = await Promise.all([
        supabase.from('workout_logs').select('*').eq('user_id', user.id).order('date'),
        supabase.from('food_logs').select('*').eq('user_id', user.id).order('date'),
        supabase.from('body_metrics').select('*').eq('user_id', user.id).order('date'),
      ])

      const toCSV = (rows: Record<string, unknown>[], cols: string[]) =>
        [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n')

      const wCols = ['date', 'type', 'duration_minutes', 'notes', 'exercises']
      const fCols = ['date', 'meal_type', 'foods']
      const mCols = ['date', 'weight_kg', 'body_fat_pct', 'muscle_mass', 'waist_cm', 'hip_cm', 'chest_cm', 'notes']

      const csv = [
        '=== 训练记录 ===',
        toCSV(wRes.data || [], wCols),
        '\n=== 饮食记录 ===',
        toCSV(fRes.data || [], fCols),
        '\n=== 身体数据 ===',
        toCSV(mRes.data || [], mCols),
      ].join('\n')

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pawside_export_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      show('导出成功')
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '导出失败', 'error')
    } finally {
      setExporting(false)
    }
  }

  async function handleModelSwitch(model: 'openai' | 'deepseek') {
    setPreferredModel(model)
    setSavingModel(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登录')
      await supabase.from('user_profiles').update({ preferred_model: model }).eq('id', user.id)
    } catch {
      // silent — next save will also persist this
    } finally {
      setSavingModel(false)
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  const goalOptions = ['减脂', '增肌', '保持']
  const genderOptions = ['男', '女']

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
                  <button key={g} onClick={() => setForm(f => ({ ...f, gender: g }))}
                    className={`flex-1 py-2 rounded-xl text-sm border ${form.gender === g ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                    {g}
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
                <label className="block text-xs text-gray-500 mb-1">体重（kg）</label>
                <input type="number" step="0.1" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="60" />
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
                  <button key={g} onClick={() => setForm(f => ({ ...f, goal: g }))}
                    className={`flex-1 py-2 rounded-xl text-sm border ${form.goal === g ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                    {g}
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

        {/* AI model */}
        <div className="bg-white rounded-2xl p-4">
          <p className="text-sm font-semibold mb-1">AI 模型</p>
          <p className="text-xs text-gray-400 mb-3">用于每日复盘分析{savingModel ? '　保存中…' : ''}</p>
          <div className="flex gap-2">
            {(['openai', 'deepseek'] as const).map(m => (
              <button key={m} onClick={() => handleModelSwitch(m)}
                className={`flex-1 py-2.5 rounded-xl text-sm border transition-colors
                  ${preferredModel === m ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                {m === 'openai' ? 'ChatGPT' : 'DeepSeek'}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-2xl overflow-hidden">
          <button onClick={handleExport} disabled={exporting}
            className="w-full px-4 py-4 text-left text-sm text-gray-700 border-b border-gray-50 disabled:opacity-50">
            {exporting ? '导出中…' : '导出数据（CSV）'}
          </button>
          <button onClick={handleLogout}
            className="w-full px-4 py-4 text-left text-sm text-red-500">
            退出登录
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
