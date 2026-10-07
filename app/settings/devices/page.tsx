'use client'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import PageHeader from '@/components/PageHeader'
import OuraTrend, { type OuraDay } from '@/components/devices/OuraTrend'
import { useToast } from '@/components/Toast'

interface Status {
  enabled: boolean
  available?: boolean
  connected?: boolean
  last_synced_at?: string | null
  last_error?: string | null
  metrics?: OuraDay[]
}

const NOTICES: Record<string, string> = {
  connected: '已连接。',
  denied: '你没有授权，所以没有连接。',
  failed: '连接没成功，请再试一次。',
  unavailable: '暂时无法连接。',
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function DevicesContent() {
  const { show, ToastEl } = useToast()
  const params = useSearchParams()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const notice = NOTICES[params.get('status') ?? '']

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/devices/oura/status', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? '暂时无法读取')
      setStatus(payload.data as Status)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法读取')
    }
  }, [])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  async function sync() {
    setBusy('sync')
    try {
      const response = await fetch('/api/devices/oura/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? '同步失败')
      if (payload.data.status === 'needs_reconnect') show('授权已失效，请重新连接', 'error')
      else if (payload.data.status === 'error') show('这次同步没成功，稍后再试', 'error')
      else show('已同步')
      await load()
    } catch (reason) {
      show(reason instanceof Error ? reason.message : '同步失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    setBusy('disconnect')
    try {
      const response = await fetch('/api/devices/oura/disconnect', { method: 'POST' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? '断开失败')
      setConfirming(false)
      show('已断开，已同步的数据已删除')
      await load()
    } catch (reason) {
      show(reason instanceof Error ? reason.message : '断开失败', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="运动健康设备" back />
      <main className="space-y-4 px-4 py-5">
        {notice && <p className="rounded-2xl bg-white p-4 text-sm text-gray-700" role="status">{notice}</p>}
        {error && <p className="rounded-2xl bg-white p-4 text-sm text-gray-600">{error}</p>}
        {status && !status.enabled && (
          <section className="rounded-2xl bg-white p-4"><p className="text-sm text-gray-600">这个功能暂未对你开放。</p></section>
        )}

        {status?.enabled && (
          <section className="rounded-2xl bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Oura</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs ${status.connected ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>
                {status.connected ? '已连接' : '未连接'}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              读取每天的睡眠、准备度和活动摘要，只在这里展示给你看。不会用来生成反馈、训练建议或休息建议，也不会改变你的训练安排。
            </p>

            {!status.connected && (
              <>
                {status.available === false
                  ? <p className="mt-4 text-sm text-gray-500">暂时无法连接。</p>
                  : <a href="/api/devices/oura/connect" className="mt-4 block w-full rounded-xl bg-black py-3 text-center text-sm font-medium text-white">连接 Oura</a>}
                <p className="mt-3 text-xs leading-5 text-gray-400">连接时只会向 Oura 申请「每日摘要」这一项权限，你可以随时在这里断开，也可以在 Oura 里撤销。</p>
              </>
            )}

            {status.connected && (
              <>
                {status.last_error && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">{status.last_error}</p>}
                <div className="mt-4"><OuraTrend metrics={status.metrics ?? []} /></div>
                <p className="mt-4 text-xs text-gray-400">{status.last_synced_at ? `上次同步：${formatTime(status.last_synced_at)}` : '还没有同步过'}</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <button type="button" onClick={sync} disabled={busy !== null}
                    className="rounded-xl border border-gray-200 py-3 text-sm font-medium text-gray-700 disabled:opacity-50">
                    {busy === 'sync' ? '同步中…' : '立即同步'}
                  </button>
                  <button type="button" onClick={() => setConfirming(true)} disabled={busy !== null}
                    className="rounded-xl border border-gray-200 py-3 text-sm font-medium text-red-500 disabled:opacity-50">
                    断开连接
                  </button>
                </div>
                {status.last_error?.includes('重新连接') && (
                  <a href="/api/devices/oura/connect" className="mt-3 block w-full rounded-xl bg-black py-3 text-center text-sm font-medium text-white">重新连接</a>
                )}
                {confirming && (
                  <div className="mt-4 rounded-xl bg-gray-50 p-4" role="alertdialog" aria-label="确认断开">
                    <p className="text-sm text-gray-800">断开后，我们会立即删除已同步的数据和授权凭据，无法恢复。</p>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <button type="button" onClick={() => setConfirming(false)} disabled={busy !== null} className="rounded-xl bg-white py-2.5 text-sm text-gray-700 disabled:opacity-50">取消</button>
                      <button type="button" onClick={disconnect} disabled={busy !== null} className="rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white disabled:opacity-50">
                        {busy === 'disconnect' ? '断开中…' : '确认断开'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {status?.enabled && <p className="px-1 text-xs text-gray-400">其他设备还在规划中。</p>}
      </main>
      {ToastEl}
    </div>
  )
}

/** 我的 → 运动健康设备. Oura only for now; display only. */
export default function DevicesPage() {
  // useSearchParams (the ?status= notice after the Oura round trip) needs a Suspense boundary.
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50"><PageHeader title="运动健康设备" back /></div>}>
      <DevicesContent />
    </Suspense>
  )
}
