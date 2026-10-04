'use client'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { useEffect, useState } from 'react'

type Settings = { day_enabled: boolean; week_enabled: boolean; month_enabled: boolean; generation_mode: 'auto' | 'manual'; pin_mode: 'until_read' | 'three_days' }
const initial: Settings = { day_enabled: true, week_enabled: true, month_enabled: true, generation_mode: 'auto', pin_mode: 'until_read' }

export default function ReviewSettingsPage() {
  const [settings, setSettings] = useState(initial)
  const [saving, setSaving] = useState(false)
  const { show, ToastEl } = useToast()
  useEffect(() => { void fetch('/api/review/settings').then((r) => r.json()).then((p) => p.data && setSettings(p.data)) }, [])
  const save = async () => {
    setSaving(true)
    const response = await fetch('/api/review/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) })
    show(response.ok ? '复盘设置已保存' : '保存失败', response.ok ? 'success' : 'error')
    setSaving(false)
  }
  const toggle = (key: 'day_enabled' | 'week_enabled' | 'month_enabled') => setSettings((value) => ({ ...value, [key]: !value[key] }))
  return <div className="min-h-screen bg-gray-50 pb-8">{ToastEl}<PageHeader title="复盘设置" back />
    <div className="px-4 py-4 space-y-4">
      <section className="bg-white rounded-2xl p-4 space-y-1"><h2 className="text-sm font-semibold mb-2">生成哪些复盘</h2>
        {([['day_enabled', '日复盘'], ['week_enabled', '周复盘'], ['month_enabled', '月复盘']] as const).map(([key, label]) => <button key={key} onClick={() => toggle(key)} className="min-h-11 w-full flex items-center justify-between text-sm"><span>{label}</span><span>{settings[key] ? '开' : '关'}</span></button>)}
      </section>
      <section className="bg-white rounded-2xl p-4"><h2 className="text-sm font-semibold mb-2">生成方式</h2>{([['auto', '打开 App 时自动生成'], ['manual', '我手动点击才生成']] as const).map(([value, label]) => <button key={value} onClick={() => setSettings((s) => ({ ...s, generation_mode: value }))} className="min-h-11 w-full text-left text-sm">{settings.generation_mode === value ? '●' : '○'} {label}</button>)}</section>
      <section className="bg-white rounded-2xl p-4"><h2 className="text-sm font-semibold mb-2">置顶保留</h2>{([['until_read', '看过就折叠'], ['three_days', '保留 3 天（月份保留 7 天）']] as const).map(([value, label]) => <button key={value} onClick={() => setSettings((s) => ({ ...s, pin_mode: value }))} className="min-h-11 w-full text-left text-sm">{settings.pin_mode === value ? '●' : '○'} {label}</button>)}</section>
      <button onClick={save} disabled={saving} className="w-full min-h-11 rounded-xl bg-black text-white text-sm disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>
    </div></div>
}
