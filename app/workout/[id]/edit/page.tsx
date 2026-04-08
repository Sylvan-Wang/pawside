'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { invalidateAIReview } from '@/lib/utils'

const WORKOUT_TYPES = ['胸', '背', '腿', '肩', '手臂', '有氧', '拉伸', '其他']

interface Exercise {
  name: string
  sets: string
  reps: string
  weight: string
}

export default function EditWorkoutPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { show, ToastEl } = useToast()

  const [date, setDate] = useState('')
  const [type, setType] = useState('')
  const [duration, setDuration] = useState('')
  const [notes, setNotes] = useState('')
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function loadData() {
      const { data, error } = await supabase.from('workout_logs').select('*').eq('id', id).single()
      if (error || !data) { router.back(); return }
      setDate(data.date)
      setType(data.type)
      setDuration(String(data.duration_minutes))
      setNotes(data.notes || '')
      setExercises(
        (data.exercises || []).map((ex: { name: string; sets?: number; reps?: string; weight?: number }) => ({
          name: ex.name || '',
          sets: ex.sets != null ? String(ex.sets) : '',
          reps: ex.reps || '',
          weight: ex.weight != null ? String(ex.weight) : '',
        }))
      )
      setLoading(false)
    }
    loadData()
  }, [id, router, supabase])

  function addExercise() {
    setExercises(ex => [...ex, { name: '', sets: '', reps: '', weight: '' }])
  }

  function updateExercise(i: number, key: keyof Exercise, val: string) {
    setExercises(ex => ex.map((e, idx) => idx === i ? { ...e, [key]: val } : e))
  }

  function removeExercise(i: number) {
    setExercises(ex => ex.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    if (!type) return show('请选择训练类型', 'error')
    if (!duration || Number(duration) <= 0) return show('训练时长须大于 0', 'error')
    setSaving(true)
    try {
      const exData = exercises.filter(e => e.name).map(e => ({
        name: e.name,
        sets: e.sets ? Number(e.sets) : undefined,
        reps: e.reps || undefined,
        weight: e.weight ? Number(e.weight) : undefined,
      }))
      const { error } = await supabase.from('workout_logs').update({
        date,
        type,
        duration_minutes: Number(duration),
        notes: notes || null,
        exercises: exData.length > 0 ? exData : null,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw error
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await invalidateAIReview(supabase, user.id, date)
      show('保存成功')
      setTimeout(() => router.back(), 1200)
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-gray-400 text-sm">加载中…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {ToastEl}
      <PageHeader title="编辑训练" back />

      <div className="px-4 py-4 space-y-4">
        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">日期</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
        </div>

        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">训练类型</label>
          <div className="flex flex-wrap gap-2">
            {WORKOUT_TYPES.map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-4 py-1.5 rounded-full text-sm border transition-colors
                  ${type === t ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-600'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">训练时长（分钟）</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400"
            placeholder="60" min="1" />
        </div>

        <div className="bg-white rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-medium text-gray-700">动作记录（可选）</label>
            <button onClick={addExercise} className="text-sm text-black font-medium">+ 添加动作</button>
          </div>
          {exercises.length === 0 && <p className="text-sm text-gray-400">暂无动作</p>}
          <div className="space-y-4">
            {exercises.map((ex, i) => (
              <div key={i} className="border border-gray-100 rounded-xl p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">动作 {i + 1}</span>
                  <button onClick={() => removeExercise(i)} className="text-xs text-red-400">删除</button>
                </div>
                <input placeholder="动作名称" value={ex.name} onChange={e => updateExercise(i, 'name', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
                <div className="grid grid-cols-3 gap-2">
                  <input placeholder="组数" type="number" value={ex.sets} onChange={e => updateExercise(i, 'sets', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none" />
                  <input placeholder="次数" value={ex.reps} onChange={e => updateExercise(i, 'reps', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none" />
                  <input placeholder="重量" type="number" value={ex.weight} onChange={e => updateExercise(i, 'weight', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">备注（可选）</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
            placeholder="今天状态不错…" />
        </div>

        <button onClick={handleSave} disabled={saving}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
          {saving ? '加载中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
