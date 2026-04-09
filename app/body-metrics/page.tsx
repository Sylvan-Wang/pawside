'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { today } from '@/lib/utils'

interface CustomMetric { name: string; value: string }

const LB_TO_KG = 0.453592

export default function BodyMetricsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { show, ToastEl } = useToast()

  const [date, setDate] = useState(today())
  const [weight, setWeight] = useState('')
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg')

  // Load user's preferred weight unit
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user
      if (!user) return
      supabase.from('user_profiles').select('weight_unit').eq('id', user.id).single()
        .then(({ data }) => { if (data?.weight_unit) setWeightUnit(data.weight_unit as 'kg' | 'lb') })
    })
  }, [supabase])
  const [bodyFat, setBodyFat] = useState('')
  const [muscleMass, setMuscleMass] = useState('')
  const [showGirth, setShowGirth] = useState(false)
  const [girth, setGirth] = useState({
    chest_cm: '', waist_cm: '', hip_cm: '',
    left_arm_cm: '', right_arm_cm: '',
    left_thigh_cm: '', right_thigh_cm: '',
    left_calf_cm: '', right_calf_cm: '',
  })
  const [customs, setCustoms] = useState<CustomMetric[]>([])
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  function n(v: string) { return v ? Number(v) : null }

  async function handleSave() {
    const hasData = weight || bodyFat || muscleMass ||
      Object.values(girth).some(v => v) || customs.some(c => c.value)
    if (!hasData) return show('请至少填写一个字段', 'error')

    const invalidCustom = customs.find(c => c.name && !c.value)
    if (invalidCustom) return show('自定义指标若有名称则必须填写数值', 'error')

    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('未登录')

      const customObj: Record<string, number> = {}
      customs.filter(c => c.name && c.value).forEach(c => { customObj[c.name] = Number(c.value) })

      // Convert lb → kg before storing (always store in kg)
      const weightKg = weight
        ? weightUnit === 'lb' ? Number(weight) * LB_TO_KG : Number(weight)
        : null

      const { error } = await supabase.from('body_metrics').insert({
        user_id: user.id,
        date,
        weight_kg: weightKg,
        body_fat_pct: n(bodyFat),
        muscle_mass: n(muscleMass),
        chest_cm: n(girth.chest_cm),
        waist_cm: n(girth.waist_cm),
        hip_cm: n(girth.hip_cm),
        left_arm_cm: n(girth.left_arm_cm),
        right_arm_cm: n(girth.right_arm_cm),
        left_thigh_cm: n(girth.left_thigh_cm),
        right_thigh_cm: n(girth.right_thigh_cm),
        left_calf_cm: n(girth.left_calf_cm),
        right_calf_cm: n(girth.right_calf_cm),
        custom_metrics: Object.keys(customObj).length > 0 ? customObj : null,
        notes: notes || null,
      })
      if (error) throw error
      show('保存成功')
      setTimeout(() => router.push('/home'), 1200)
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  const girthFields = [
    { key: 'chest_cm', label: '胸围（cm）' },
    { key: 'waist_cm', label: '腰围（cm）' },
    { key: 'hip_cm', label: '臀围（cm）' },
    { key: 'left_arm_cm', label: '左臂围（cm）' },
    { key: 'right_arm_cm', label: '右臂围（cm）' },
    { key: 'left_thigh_cm', label: '左腿围（cm）' },
    { key: 'right_thigh_cm', label: '右腿围（cm）' },
    { key: 'left_calf_cm', label: '左小腿围（cm）' },
    { key: 'right_calf_cm', label: '右小腿围（cm）' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {ToastEl}
      <PageHeader title="记录身体数据" back />

      <div className="px-4 py-4 space-y-4">
        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">日期</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400" />
        </div>

        {/* Basic */}
        <div className="bg-white rounded-2xl p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">基础数据</p>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-500">体重</label>
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                {(['kg', 'lb'] as const).map(u => (
                  <button key={u} type="button" onClick={() => setWeightUnit(u)}
                    className={`px-3 py-1 text-xs transition-colors ${weightUnit === u ? 'bg-black text-white' : 'text-gray-500'}`}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <input type="number" step="0.1" value={weight} onChange={e => setWeight(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-gray-400"
              placeholder={weightUnit === 'kg' ? '62.5' : '138'} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">体脂率（可选）</label>
              <input type="number" step="0.1" value={bodyFat} onChange={e => setBodyFat(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="21.3" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">肌肉量（可选）</label>
              <input type="number" step="0.1" value={muscleMass} onChange={e => setMuscleMass(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none" placeholder="45.0" />
            </div>
          </div>
        </div>

        {/* Girth */}
        <div className="bg-white rounded-2xl p-4">
          <button onClick={() => setShowGirth(!showGirth)}
            className="w-full flex justify-between items-center text-sm font-medium text-gray-700">
            围度数据（可选）
            <span className="text-gray-400">{showGirth ? '▲' : '▼'}</span>
          </button>
          {showGirth && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {girthFields.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input type="number" step="0.1" value={girth[key as keyof typeof girth]}
                    onChange={e => setGirth(g => ({ ...g, [key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" placeholder="—" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Custom metrics */}
        <div className="bg-white rounded-2xl p-4">
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm font-medium text-gray-700">自定义指标</p>
            <button onClick={() => setCustoms(c => [...c, { name: '', value: '' }])}
              className="text-sm text-black font-medium">+ 添加自定义指标</button>
          </div>
          {customs.length === 0 && <p className="text-sm text-gray-400">暂无自定义指标</p>}
          <div className="space-y-2">
            {customs.map((c, i) => (
              <div key={i} className="grid grid-cols-5 gap-2 items-center">
                <input placeholder="指标名称" value={c.name}
                  onChange={e => setCustoms(cs => cs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  className="col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
                <input placeholder="数值" type="number" value={c.value}
                  onChange={e => setCustoms(cs => cs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                  className="col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none" />
                <button onClick={() => setCustoms(cs => cs.filter((_, j) => j !== i))}
                  className="text-red-400 text-sm">×</button>
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-2xl p-4">
          <label className="block text-sm text-gray-600 mb-1">备注（可选）</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
            placeholder="晚饭后测量…" />
        </div>

        <button onClick={handleSave} disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
          {loading ? '加载中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
