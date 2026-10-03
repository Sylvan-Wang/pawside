'use client'

import { useEffect, useState } from 'react'
import { recoveryFollowUp, type RecoveryWorkoutPrompt } from '@/lib/recovery-prompt'
import { today } from '@/lib/utils'

interface PromptPayload {
  should_prompt: boolean
  training_in_progress: boolean
  workout: RecoveryWorkoutPrompt | null
}

const SLEEP_OPTIONS = [
  { label: '很差', value: 1 },
  { label: '不太好', value: 2 },
  { label: '一般', value: 3 },
  { label: '还行', value: 4 },
  { label: '很好', value: 5 },
] as const

const SORENESS_OPTIONS = [
  { label: '不酸', value: 5 },
  { label: '有点酸', value: 3 },
  { label: '很酸', value: 1 },
] as const

export default function RecoveryCheckinSheet() {
  const [prompt, setPrompt] = useState<PromptPayload | null>(null)
  const [sleep, setSleep] = useState<number | null>(null)
  const [soreness, setSoreness] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const date = today()

    void fetch(`/api/recovery/checkin?date=${date}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null
        return response.json()
      })
      .then((payload) => {
        if (!active || !payload?.data) return
        setPrompt({
          should_prompt: Boolean(payload.data.should_prompt),
          training_in_progress: Boolean(payload.data.training_in_progress),
          workout: payload.data.workout ?? null,
        })
      })
      .catch(() => undefined)

    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function submit(skipped: boolean) {
    if (!skipped && sleep === null) {
      setError('请先选择昨晚的睡眠感受')
      return
    }
    if (!skipped && prompt?.workout && soreness === null) {
      setError('请选择训练后的酸痛感受')
      return
    }

    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/recovery/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: today(),
          sleep_quality: skipped ? null : sleep,
          post_workout_recovery: skipped ? null : soreness,
          skipped,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error?.message || '保存失败')
      }

      const followUp = skipped ? null : recoveryFollowUp(prompt?.workout ?? null, soreness)
      setPrompt((current) => current ? { ...current, should_prompt: false } : current)
      setNotice(followUp)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法保存，请稍后再试')
    } finally {
      setSaving(false)
    }
  }

  const visible = Boolean(prompt?.should_prompt && !prompt.training_in_progress)
  const relativeDay = prompt?.workout?.days_ago === 1 ? '昨天' : '前天'

  return (
    <>
      {visible && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35" role="presentation">
          <section
            aria-labelledby="recovery-sheet-title"
            aria-modal="true"
            role="dialog"
            className="w-full max-w-[480px] rounded-t-[28px] bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 shadow-2xl"
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-gray-200" />
            <h2 id="recovery-sheet-title" className="text-lg font-semibold text-gray-950">早上好，昨晚睡得怎么样？</h2>
            <div className="mt-3 grid grid-cols-5 gap-1.5">
              {SLEEP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={sleep === option.value}
                  onClick={() => { setSleep(option.value); setError('') }}
                  className={sleep === option.value
                    ? 'rounded-xl border border-black bg-black px-1 py-2.5 text-xs text-white'
                    : 'rounded-xl border border-gray-200 px-1 py-2.5 text-xs text-gray-700'}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {prompt?.workout && (
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-gray-900">
                  {relativeDay}练了{prompt.workout.split_label}，{prompt.workout.muscles}还酸吗？
                </h3>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {SORENESS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={soreness === option.value}
                      onClick={() => { setSoreness(option.value); setError('') }}
                      className={soreness === option.value
                        ? 'rounded-xl border border-black bg-black py-2.5 text-sm text-white'
                        : 'rounded-xl border border-gray-200 py-2.5 text-sm text-gray-700'}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-6 flex gap-2">
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={saving}
                className="flex-1 rounded-xl bg-black py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? '保存中…' : '完成'}
              </button>
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={saving}
                className="rounded-xl border border-gray-200 px-5 py-3 text-sm text-gray-600 disabled:opacity-50"
              >
                跳过
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && (
        <div className="fixed inset-x-4 bottom-6 z-[75] mx-auto max-w-[448px] rounded-2xl bg-black px-4 py-3 text-sm leading-6 text-white shadow-xl" role="status">
          {notice}
        </div>
      )}
    </>
  )
}
