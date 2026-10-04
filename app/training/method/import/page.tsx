'use client'

import PageHeader from '@/components/PageHeader'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type Outline = {
  method_name: string | null
  variants: { label: string; section_quote: string }[]
  days: { name_zh: string; variant_label: string | null }[]
}

type Manifest = {
  method: { nameZh: string }
  days: Array<{ nameZh: string; exercises: Array<{ ref: { name: string }; sets: unknown[] }> }>
  openQuestions: Array<{ path: string; question: string }>
  [key: string]: unknown
}

const CONSENT = '我了解这份计划来自我自己提供的内容，并非 Pawside 官方方法。我承诺对自己的健康负责，量力而行；如有不适请立即停止并咨询专业人士。'

function acceptSuggestions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(acceptSuggestions)
  if (!value || typeof value !== 'object') return value
  const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, acceptSuggestions(item)]))
  if (next.authority === 'ai_inferred' && next.value != null) next.authority = 'user_corrected'
  if ('openQuestions' in next && !containsUnresolvedSuggestion(next)) next.openQuestions = []
  return next
}

function containsUnresolvedSuggestion(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnresolvedSuggestion)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.authority === 'ai_inferred' && record.value == null) return true
  return Object.values(record).some(containsUnresolvedSuggestion)
}

export default function MethodImportPage() {
  const router = useRouter()
  const [rawText, setRawText] = useState('')
  const [consented, setConsented] = useState(false)
  const [importId, setImportId] = useState('')
  const [outline, setOutline] = useState<Outline | null>(null)
  const [selectedVariant, setSelectedVariant] = useState('')
  const [completedDays, setCompletedDays] = useState(0)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState<{ method_id: string; release_id: string } | null>(null)

  async function json(response: Response) {
    const payload = await response.json()
    if (!response.ok) throw new Error(payload?.error?.message || '请求失败')
    return payload.data
  }

  async function begin() {
    setBusy(true); setError('')
    try {
      const created = await json(await fetch('/api/method-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText, consent_accepted: true, consent_version: 'health-v1' }),
      }))
      setImportId(created.id)
      const extracted = await json(await fetch(`/api/method-import/${created.id}/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'outline' }),
      }))
      setOutline(extracted.outline)
      if (extracted.outline.variants.length <= 1) {
        await extractDays(created.id, extracted.outline, extracted.outline.variants[0]?.label || '')
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '识别失败') }
    finally { setBusy(false) }
  }

  async function extractDays(id = importId, currentOutline = outline, variant = selectedVariant) {
    if (!id || !currentOutline) return
    setBusy(true); setError('')
    try {
      const days = currentOutline.days.filter((day) => !variant || day.variant_label == null || day.variant_label === variant)
      for (let dayIndex = completedDays; dayIndex < days.length; dayIndex += 1) {
        const data = await json(await fetch(`/api/method-import/${id}/extract`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: 'day', day_index: dayIndex, selected_variant: variant || undefined }),
        }))
        setCompletedDays(dayIndex + 1)
        if (data.manifest) setManifest(data.manifest)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '这一天识别失败，可以重试') }
    finally { setBusy(false) }
  }

  async function acceptAll() {
    if (!manifest) return
    setBusy(true); setError('')
    try {
      const next = acceptSuggestions(manifest) as Manifest
      const data = await json(await fetch(`/api/method-import/${importId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest_draft: next, status: 'review' }),
      }))
      setManifest(data.manifest_draft)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function publish(enroll: boolean) {
    setBusy(true); setError('')
    try {
      const data = await json(await fetch(`/api/method-import/${importId}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enroll }),
      }))
      setPublished(data)
      if (enroll) router.push('/training/today')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败') }
    finally { setBusy(false) }
  }

  const variantChoice = outline && outline.variants.length > 1 && !manifest && completedDays === 0
  const selectedDays = outline?.days.filter((day) => !selectedVariant || day.variant_label == null || day.variant_label === selectedVariant) ?? []

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="导入训练计划" back />
      <main className="space-y-4 px-4 py-5">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {!importId && (
          <section className="space-y-4 rounded-2xl bg-white p-4">
            <div><h1 className="text-lg font-semibold">粘贴一篇训练计划的文字</h1><p className="mt-1 text-sm text-gray-500">只支持文字，最多 30000 字。</p></div>
            <textarea value={rawText} onChange={(event) => setRawText(event.target.value.slice(0, 30000))} rows={12}
              className="w-full rounded-xl border border-gray-200 p-3 text-sm" placeholder="在这里粘贴训练文章…" />
            <p className={`text-right text-xs ${rawText.length >= 30000 ? 'text-red-600' : 'text-gray-400'}`}>{rawText.length} / 30000</p>
            <label className="flex gap-3 text-sm leading-6 text-gray-700"><input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} className="mt-1" /><span>{CONSENT}</span></label>
            <button type="button" disabled={busy || !consented || rawText.trim().length < 50} onClick={begin}
              className="w-full rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-40">{busy ? '正在识别…' : '开始识别'}</button>
          </section>
        )}

        {variantChoice && (
          <section className="rounded-2xl bg-white p-4">
            <h1 className="font-semibold">文章里有 {outline.variants.length} 套方案，导入哪一套？</h1>
            <div className="mt-3 space-y-2">{outline.variants.map((variant) => (
              <label key={variant.label} className="flex gap-2 rounded-xl border border-gray-200 p-3 text-sm"><input type="radio" name="variant" checked={selectedVariant === variant.label} onChange={() => setSelectedVariant(variant.label)} />{variant.label}</label>
            ))}</div>
            <button type="button" disabled={!selectedVariant || busy} onClick={() => extractDays(importId, outline, selectedVariant)} className="mt-4 w-full rounded-xl bg-black py-3 text-sm text-white disabled:opacity-40">继续</button>
          </section>
        )}

        {outline && !manifest && !variantChoice && (
          <section className="rounded-2xl bg-white p-4">
            <h1 className="font-semibold">正在识别…</h1>
            <p className="mt-2 text-sm text-gray-500">✓ 找到 {selectedDays.length || outline.days.length} 个训练日</p>
            <div className="mt-3 space-y-2 text-sm">{selectedDays.map((day, index) => <p key={`${day.name_zh}:${index}`}>{index < completedDays ? '✓' : index === completedDays && busy ? '…' : '○'} {day.name_zh}</p>)}</div>
            {!busy && <button type="button" onClick={() => extractDays()} className="mt-4 rounded-lg border border-gray-200 px-3 py-2 text-sm">重试这一天</button>}
          </section>
        )}

        {manifest && !published && (
          <section className="space-y-4 rounded-2xl bg-white p-4">
            <div><p className="text-sm text-emerald-700">识别完成</p><h1 className="mt-1 text-xl font-semibold">「{manifest.method.nameZh}」· {manifest.days.length} 天 · {manifest.days.reduce((sum, day) => sum + day.exercises.length, 0)} 个动作</h1></div>
            {manifest.openQuestions.length > 0 && <button type="button" onClick={acceptAll} className="w-full rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-900">{manifest.openQuestions.length} 项需要你看一眼 · 全部接受建议</button>}
            <div className="space-y-2">{manifest.days.map((day) => <details key={day.nameZh} className="rounded-xl border border-gray-100 p-3"><summary className="font-medium">{day.nameZh}（{day.exercises.length} 个动作）</summary><ul className="mt-2 space-y-1 text-sm text-gray-600">{day.exercises.map((exercise) => <li key={exercise.ref.name}>{exercise.ref.name} · {exercise.sets.length} 组</li>)}</ul></details>)}</div>
            <button type="button" disabled={busy} onClick={() => publish(true)} className="w-full rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-40">开始使用这套方法</button>
            <button type="button" disabled={busy} onClick={() => publish(false)} className="w-full py-2 text-sm text-gray-500">先保存，稍后再看</button>
          </section>
        )}

        {published && (
          <section className="rounded-2xl bg-white p-5 text-center"><h1 className="text-xl font-semibold">已保存为你的方法</h1><button type="button" onClick={() => router.push(`/training/method?release=${published.release_id}`)} className="mt-4 rounded-xl bg-black px-5 py-3 text-sm text-white">查看方法</button></section>
        )}
      </main>
    </div>
  )
}
