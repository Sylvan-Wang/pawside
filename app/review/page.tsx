'use client'
import BottomNav from '@/components/BottomNav'
import CoachCard from '@/components/CoachCard'
import PageHeader from '@/components/PageHeader'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

type Tier = 'day' | 'week' | 'month'
type Item = {
  tier: Tier; period_start: string; period_end: string; record_days: number; workout_count: number
  current: boolean; unread: boolean; pinned: boolean; state: 'current' | 'ready' | 'insufficient'
  should_generate: boolean; show_generate_action: boolean; detail_href: string; content: Record<string, unknown> | null
}

const label: Record<Tier, string> = { day: '今日复盘', week: '周复盘', month: '月复盘' }
const range = (item: Item) => item.tier === 'day' ? item.period_start.slice(5) : `${item.period_start.slice(5)}–${item.period_end.slice(5)}`
const strings = (value: unknown): string[] => Array.isArray(value)
  ? value.flatMap((item) => typeof item === 'string' ? [item] : item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string' ? [(item as { text: string }).text] : [])
  : []

function coachProps(content: Record<string, unknown> | null) {
  if (!content) return { headline: null, bullets: [] as string[], actions: [] as string[] }
  return {
    headline: String(content.overall ?? content.what_happened ?? content.summary ?? ''),
    bullets: strings(content.key_findings ?? content.worth_noting ?? content.observations),
    actions: strings(content.tomorrow_guidance ?? content.next_week ?? content.next_actions),
  }
}

export default function ReviewPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const autoAttempted = useRef(new Set<string>())
  const load = useCallback(async () => {
    const response = await fetch('/api/review/feed', { cache: 'no-store' })
    if (!response.ok) { setLoading(false); return }
    const payload = await response.json(); setItems(payload.data.items); setLoading(false)
  }, [])
  useEffect(() => { void Promise.resolve().then(load) }, [load])

  const markRead = async (item: Item) => {
    const key = `${item.tier}:${item.period_start}`
    setExpandedKeys((current) => new Set(current).add(key))
    if (!item.unread || item.current) return
    await fetch('/api/review/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier: item.tier, period_start: item.period_start }) })
    await load()
  }
  const generate = async (item: Item) => {
    if (item.tier === 'day') return
    setGenerating(`${item.tier}:${item.period_start}`)
    await fetch('/api/ai/compose', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.tier === 'week'
        ? { surface: 'weekly_review', week_start: item.period_start }
        : { surface: 'monthly_review', month_start: item.period_start }),
    })
    setGenerating(null); await load()
  }
  useEffect(() => {
    const item = items.find((candidate) => candidate.should_generate)
    if (!item) return
    const key = `${item.tier}:${item.period_start}`
    if (autoAttempted.current.has(key)) return
    autoAttempted.current.add(key)
    void generate(item)
  // generate intentionally depends on load and is invoked once per period via autoAttempted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  return <div className="min-h-screen bg-gray-50 pb-20"><PageHeader title="复盘" />
    <div className="px-4 py-4 space-y-3">
      <div className="flex justify-end"><Link href="/settings/review" className="min-h-11 inline-flex items-center text-sm text-gray-500">复盘设置</Link></div>
      {loading && <p className="py-8 text-center text-sm text-gray-400">加载中…</p>}
      {!loading && items.map((item) => {
        const coach = coachProps(item.content)
        const expanded = item.pinned || expandedKeys.has(`${item.tier}:${item.period_start}`)
        return <section key={`${item.tier}:${item.period_start}`} className="bg-white rounded-2xl p-4">
          <button type="button" onClick={() => void markRead(item)} className="min-h-11 w-full flex items-center justify-between text-left">
            <span className="text-sm font-semibold">{expanded ? '▌' : '▸'} {item.current ? (item.tier === 'week' ? '本周 · 进行中' : item.tier === 'month' ? '本月 · 进行中' : label[item.tier]) : label[item.tier]} · {range(item)}</span>
            {item.unread && !item.current && <span className="text-xs text-gray-500">新</span>}
          </button>
          {item.current && <p className="text-xs text-gray-400">已记录 {item.record_days} 天 · 训练 {item.workout_count} 次</p>}
          {!item.current && item.state === 'insufficient' && <CoachCard state="insufficient" insufficientText={`${item.tier === 'week' ? '本周' : '本月'}只记录了 ${item.record_days} 天，暂不生成复盘。`} />}
          {!item.current && item.state === 'ready' && expanded && <CoachCard state={item.content ? 'ai' : 'basic'} headline={coach.headline ?? `已记录 ${item.record_days} 天，训练 ${item.workout_count} 次`} bullets={coach.bullets} actions={coach.actions} basicLabel="基础总结 · AI 复盘暂时没有生成" onRetry={() => void generate(item)} retrying={generating === `${item.tier}:${item.period_start}`}>
            <Link href={item.detail_href} className="mt-3 min-h-11 inline-flex items-center text-xs text-gray-600">查看完整{item.tier === 'week' ? '周报' : item.tier === 'month' ? '月报' : '当日记录'} →</Link>
          </CoachCard>}
          {item.show_generate_action && <button onClick={() => void generate(item)} disabled={generating !== null} className="mt-2 min-h-11 px-4 rounded-xl bg-black text-white text-sm disabled:opacity-50">{generating === `${item.tier}:${item.period_start}` ? '生成中…' : '生成复盘'}</button>}
        </section>
      })}
    </div><BottomNav /></div>
}
