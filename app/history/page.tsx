'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import BottomNav from '@/components/BottomNav'
import PageHeader from '@/components/PageHeader'

interface DayEntry {
  date: string
  workouts: { type: string; duration_minutes: number }[]
  foods: { meal_type: string }[]
  hasMetrics: boolean
}

const PAGE_SIZE = 7

export default function HistoryPage() {
  const router = useRouter()
  const supabase = createClient()
  const [entries, setEntries] = useState<DayEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/auth'); return }

    const [workoutRes, foodRes, metricsRes] = await Promise.all([
      supabase.from('workout_logs').select('date,type,duration_minutes').eq('user_id', user.id).order('date', { ascending: false }),
      supabase.from('food_logs').select('date,meal_type').eq('user_id', user.id).order('date', { ascending: false }),
      supabase.from('body_metrics').select('date').eq('user_id', user.id),
    ])

    const dateMap = new Map<string, DayEntry>()
    const ensure = (d: string) => {
      if (!dateMap.has(d)) dateMap.set(d, { date: d, workouts: [], foods: [], hasMetrics: false })
      return dateMap.get(d)!
    }

    ;(workoutRes.data || []).forEach(w => ensure(w.date).workouts.push(w))
    ;(foodRes.data || []).forEach(f => ensure(f.date).foods.push(f))
    ;(metricsRes.data || []).forEach(m => ensure(m.date).hasMetrics = true)

    const sorted = Array.from(dateMap.values()).sort((a, b) => b.date.localeCompare(a.date))
    setEntries(sorted)
    setLoading(false)
  }, [router, supabase])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const pageEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <PageHeader title="历史记录" />

      <div className="px-4 py-4 space-y-3">
        {loading && <p className="text-center text-sm text-gray-400 py-8">加载中…</p>}
        {!loading && entries.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">暂无记录</p>
            <p className="text-gray-300 text-xs mt-1">还没有数据，快去记录吧～</p>
          </div>
        )}
        {pageEntries.map(entry => (
          <div key={entry.date} className="bg-white rounded-2xl p-4">
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0 mr-3">
                <p className="text-sm font-semibold text-gray-900">{entry.date}</p>
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-gray-500">
                    训练：{entry.workouts.length > 0
                      ? <span className="text-black">{entry.workouts.map(w => w.type).join('、')} · {entry.workouts.reduce((s, w) => s + w.duration_minutes, 0)} 分钟</span>
                      : <span className="text-gray-300">未记录</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    饮食：{entry.foods.length > 0
                      ? <span className="text-black">{entry.foods.map(f => f.meal_type).join('、')}</span>
                      : <span className="text-gray-300">未记录</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    身体数据：{entry.hasMetrics
                      ? <span className="text-black">已记录</span>
                      : <span className="text-gray-300">未记录</span>}
                  </p>
                </div>
              </div>
              <button
                onClick={() => router.push(`/history/${entry.date}`)}
                className="flex-shrink-0 text-xs text-black border border-gray-200 px-3 py-1.5 rounded-lg mt-1"
              >
                查看详情
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {!loading && entries.length > PAGE_SIZE && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white border-t border-gray-100 px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-sm text-gray-600 disabled:text-gray-300 px-3 py-1.5 border border-gray-200 rounded-lg disabled:border-gray-100"
          >
            上一页
          </button>
          <p className="text-xs text-gray-400">第 {page} / {totalPages} 页</p>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="text-sm text-gray-600 disabled:text-gray-300 px-3 py-1.5 border border-gray-200 rounded-lg disabled:border-gray-100"
          >
            下一页
          </button>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
