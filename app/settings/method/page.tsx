'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageHeader from '@/components/PageHeader'
import { useToast } from '@/components/Toast'
import { clearTrainingNavigationCache } from '@/lib/training-navigation-cache'

interface MethodDay {
  key: string
  name_zh: string
  required: boolean
  day_type: string
  exercise_count: number
}

interface MethodOption {
  release_id: string
  short_name: string
  name: string | null
  description: string | null
  is_current: boolean
  days: MethodDay[]
}

function firstDayName(method: MethodOption) {
  return (method.days.find((day) => day.required) ?? method.days[0])?.name_zh ?? ''
}

export default function MethodSettingsPage() {
  const router = useRouter()
  const { show, ToastEl } = useToast()
  const [methods, setMethods] = useState<MethodOption[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<MethodOption | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/method/library', { cache: 'no-store' })
      if (response.status === 401) { router.push('/auth'); return }
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? '暂时无法读取训练方法')
      setMethods(payload.data.methods as MethodOption[])
      setLoadError(null)
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : '暂时无法读取训练方法')
    }
  }, [router])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  const current = methods?.find((method) => method.is_current) ?? null

  async function confirmSwitch() {
    if (!pending || switching) return
    setSwitching(true)
    setSwitchError(null)
    try {
      const response = await fetch('/api/method/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method_release_id: pending.release_id }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? '暂时无法切换训练方法')
      clearTrainingNavigationCache()
      show(`已切换到${pending.short_name}`)
      setPending(null)
      router.replace('/training/today')
    } catch (reason) {
      setSwitchError(reason instanceof Error ? reason.message : '暂时无法切换训练方法')
      setSwitching(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="训练方法" back />
      {ToastEl}
      <main className="space-y-4 px-4 py-5">
        {!methods && !loadError && <p className="rounded-2xl bg-white p-5 text-sm text-gray-500">正在读取训练方法…</p>}
        {loadError && <p className="rounded-2xl bg-white p-5 text-sm text-gray-600">{loadError}</p>}

        {methods && (
          <p className="px-1 text-xs leading-5 text-gray-400">
            当前使用：{current?.short_name ?? '未启用'}。切换不会删除任何训练记录。
          </p>
        )}

        {methods?.map((method) => (
          <section key={method.release_id} className={`rounded-2xl bg-white p-4 ${method.is_current ? 'ring-1 ring-black' : ''}`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-gray-900">{method.short_name}</h2>
              {method.is_current && (
                <span className="rounded-full bg-black px-2.5 py-1 text-[11px] text-white">当前使用</span>
              )}
            </div>
            {method.description && <p className="mt-2 text-sm leading-6 text-gray-600">{method.description}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {method.days.map((day) => (
                <span key={day.key} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
                  {day.name_zh}{day.required ? '' : '（可选）'} · {day.exercise_count} 个动作
                </span>
              ))}
            </div>
            {!method.is_current && (
              <button
                type="button"
                onClick={() => { setSwitchError(null); setPending(method) }}
                className="mt-4 w-full rounded-xl bg-black py-3 text-sm font-medium text-white"
              >
                切换到{method.short_name}
              </button>
            )}
          </section>
        ))}
      </main>

      {pending && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="switch-title">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <h2 id="switch-title" className="text-base font-semibold text-gray-900">确定要切换训练方法吗？</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              将从「{current?.short_name ?? '当前方法'}」切换到「{pending.short_name}」。
            </p>
            <ul className="mt-3 space-y-1.5 text-sm leading-6 text-gray-700">
              <li>• 你过往的训练记录不会丢失</li>
              <li>• 之后会按新的方法安排训练，从「{firstDayName(pending)}」开始</li>
              <li>• 随时可以在这里切换回来</li>
            </ul>
            {switchError && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{switchError}</p>}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={switching}
                className="rounded-xl border border-gray-200 py-3 text-sm text-gray-700 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmSwitch}
                disabled={switching}
                className="rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {switching ? '切换中…' : '确认切换'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
