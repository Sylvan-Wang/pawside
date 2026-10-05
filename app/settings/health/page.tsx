'use client'
import { useCallback, useEffect, useState } from 'react'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'

interface SystemAlert {
  id: string
  kind: string
  severity: 'info' | 'warning' | 'critical'
  status: 'open' | 'resolved'
  summary: string
  repair_prompt: string | null
  occurrences: number
  first_seen: string
  last_seen: string
  resolved_at: string | null
}

const SEVERITY_LABEL: Record<SystemAlert['severity'], string> = { info: '提示', warning: '警告', critical: '严重' }
const SEVERITY_CLASS: Record<SystemAlert['severity'], string> = {
  info: 'bg-gray-100 text-gray-700',
  warning: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-700',
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Owner-only: unresolved system alerts with a ready-to-send repair note. */
export default function HealthPage() {
  const { show, ToastEl } = useToast()
  const [alerts, setAlerts] = useState<SystemAlert[] | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/owner/alerts', { cache: 'no-store' })
      if (response.status === 404) { setNotFound(true); return }
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? '暂时无法读取')
      setAlerts(payload.data.alerts as SystemAlert[])
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法读取')
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  async function copyPrompt(alert: SystemAlert) {
    if (!alert.repair_prompt) return
    try {
      await navigator.clipboard.writeText(alert.repair_prompt)
      show('已复制，可以直接发给 AI')
    } catch {
      show('复制失败，请长按文字手动复制', 'error')
    }
  }

  async function resolve(alert: SystemAlert) {
    setBusyId(alert.id)
    try {
      const response = await fetch(`/api/owner/alerts/${alert.id}/resolve`, { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? '暂时无法更新')
      await load()
    } catch (reason) {
      show(reason instanceof Error ? reason.message : '暂时无法更新', 'error')
    } finally {
      setBusyId('')
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="页面不存在" back />
      </div>
    )
  }

  const open = (alerts ?? []).filter((alert) => alert.status === 'open')
  const resolved = (alerts ?? []).filter((alert) => alert.status === 'resolved')

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="数据健康" back />
      {ToastEl}
      <main className="space-y-4 px-4 py-5">
        {!alerts && !error && <p className="rounded-2xl bg-white p-5 text-sm text-gray-500">正在读取…</p>}
        {error && <p className="rounded-2xl bg-white p-5 text-sm text-gray-600">{error}</p>}
        {alerts && open.length === 0 && (
          <p className="rounded-2xl bg-white p-5 text-sm text-gray-600">目前没有未处理的告警。</p>
        )}

        {open.map((alert) => (
          <section key={alert.id} className="rounded-2xl bg-white p-4">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${SEVERITY_CLASS[alert.severity]}`}>{SEVERITY_LABEL[alert.severity]}</span>
              <span className="text-xs text-gray-400">出现 {alert.occurrences} 次 · 最近 {formatTime(alert.last_seen)}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-gray-900">{alert.summary}</p>
            {alert.repair_prompt && (
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-600">{alert.repair_prompt}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => copyPrompt(alert)} disabled={!alert.repair_prompt}
                className="rounded-xl border border-gray-200 py-2.5 text-sm text-gray-700 disabled:opacity-40">
                复制修复说明
              </button>
              <button type="button" onClick={() => resolve(alert)} disabled={busyId === alert.id}
                className="rounded-xl bg-black py-2.5 text-sm font-medium text-white disabled:opacity-50">
                已处理
              </button>
            </div>
          </section>
        ))}

        {resolved.length > 0 && (
          <section className="rounded-2xl bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">已处理</h2>
            <ul className="mt-2 space-y-2">
              {resolved.slice(0, 20).map((alert) => (
                <li key={alert.id} className="text-xs leading-5 text-gray-500">
                  {alert.summary}（{alert.resolved_at ? formatTime(alert.resolved_at) : ''}）
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
