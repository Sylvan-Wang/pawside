'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { today, invalidateAIReview } from '@/lib/utils'

const WORKOUT_TYPES = ['胸', '背', '腿', '肩', '手臂', '有氧', '拉伸', '其他']

interface Exercise {
  name: string
  sets: string
  reps: string
  weight: string
}

export default function WorkoutPage() {
  const router = useRouter()
  const supabase = createClient()
  const { show, ToastEl } = useToast()

  const [date, setDate] = useState(today())
  const [type, setType] = useState('')
  const [duration, setDuration] = useState('')
  const [notes, setNotes] = useState('')
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(false)
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user
      if (!user) return
      supabase.from('user_profiles').select('weight_unit').eq('id', user.id).single()
        .then(({ data }) => { if (data?.weight_unit) setWeightUnit(data.weight_unit as 'kg' | 'lb') })
    })
  }, [supabase])

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
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登录')
      const exData = exercises.filter(e => e.name).map(e => ({
        name: e.name,
        sets: e.sets ? Number(e.sets) : undefined,
        reps: e.reps || undefined,
        weight: e.weight ? Number(e.weight) : undefined,
      }))
      const { error } = await supabase.from('workout_logs').insert({
        user_id: user.id,
        date,
        type,
        duration_minutes: Number(duration),
        notes: notes || null,
        exercises: exData.length > 0 ? exData : null,
      })
      if (error) throw error
      await invalidateAIReview(supabase, user.id, date)
      show('保存成功')
      setTimeout(() => router.push('/home'), 1200)
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {ToastEl}
      <PageHeader title="记录训练" back />

      <div className="px-4 py-4 space-y-4">
        {/* Date */}
        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">日期</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
        </div>

        {/* Type */}
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

        {/* Duration */}
        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">训练时长（分钟）</label>
          <input type="number" value={duration} onChange={e => setDuration(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400"
            placeholder="60" min="1" />
        </div>

        {/* Exercises */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <label className="text-sm font-medium text-gray-700">动作记录（可选）</label>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                {(['kg', 'lb'] as const).map(u => (
                  <button key={u} type="button" onClick={() => setWeightUnit(u)}
                    className={`px-2.5 py-1 text-xs transition-colors ${weightUnit === u ? 'bg-black text-white' : 'text-gray-500'}`}>
                    {u}
                  </button>
                ))}
              </div>
              <button onClick={addExercise} className="text-sm text-black font-medium">+ 添加动作</button>
            </div>
          </div>
          {exercises.length === 0 && (
            <p className="text-sm text-gray-400">暂无动作，可选择添加</p>
          )}
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
                  <input placeholder={`重量(${weightUnit})`} type="number" value={ex.weight} onChange={e => updateExercise(i, 'weight', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">备注（可选）</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400 resize-none"
            placeholder="今天状态不错…" />
        </div>

        <button onClick={handleSave} disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
          {loading ? '加载中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
