'use client'

import PageHeader from '@/components/PageHeader'
import { useEffect, useState } from 'react'

interface Adjustment {
  id: string
  split_key: string
  action: string
  payload: Record<string, unknown>
}

const actionLabels: Record<string, string> = {
  hide_exercise: '不做这个动作',
  swap_exercise: '替换动作',
  set_count: '调整组数',
  rep_range: '调整次数',
}

export default function MethodAdjustmentsPage() {
  const [items, setItems] = useState<Adjustment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetch('/api/method/adjustments', { cache: 'no-store' })
      .then(async (response) => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!active) return
        if (!response.ok) setError(payload?.error?.message || '暂时无法读取调整')
        else setItems(payload.data.adjustments)
      })
      .catch(() => { if (active) setError('暂时无法读取调整') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function revoke(id: string) {
    setError('')
    const response = await fetch(`/api/method/adjustments?id=${id}`, { method: 'DELETE' })
    const payload = await response.json()
    if (!response.ok) setError(payload?.error?.message || '撤销失败')
    else setItems((current) => current.filter((item) => item.id !== id))
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="我的调整" back />
      <main className="space-y-3 px-4 py-5">
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {loading ? <p className="text-sm text-gray-500">正在读取…</p> : items.length === 0 ? (
          <div className="rounded-2xl bg-white p-5 text-sm text-gray-500">还没有长期调整。</div>
        ) : items.map((item) => (
          <section key={item.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4">
            <div>
              <p className="font-medium text-gray-900">{actionLabels[item.action] || '训练调整'}</p>
              <p className="mt-1 text-xs text-gray-400">训练日：{item.split_key}</p>
            </div>
            <button type="button" onClick={() => revoke(item.id)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">撤销</button>
          </section>
        ))}
      </main>
    </div>
  )
}
