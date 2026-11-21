'use client'

import CatMascot from '@/components/CatMascot'
import { markTourSeen, readSeenVersion } from '@/lib/tour/storage'
import { stepsFor, TOUR_STEPS, TOUR_VERSION, type TourStep } from '@/lib/tour/steps'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { translate, type MessageKey } from '@/lib/i18n'
import { useLocale } from '@/lib/i18n/use-locale'

/**
 * Walkthrough sheet. Mounted on Home for signed-in users who finished onboarding.
 * - never seen it: all steps
 * - saw an older version: only the steps added since
 * - `replay`: all steps, regardless of what was seen (used by Settings)
 */
export default function AppTour({
  ready,
  replay = false,
  onClose,
}: {
  ready: boolean
  replay?: boolean
  onClose?: () => void
}) {
  const router = useRouter()
  const [locale] = useLocale()
  const t = (key: MessageKey) => translate(locale, key)
  // Chinese step text stays in lib/tour/steps.ts; English comes from the dictionary by step id.
  const stepText = (step: TourStep, field: 'title' | 'body' | 'hrefLabel') =>
    locale === 'en' ? translate('en', `common.tour.steps.${step.id}.${field}` as MessageKey) : (step[field] ?? '')
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  // `ready` only turns true after Home has loaded client-side, so reading
  // localStorage here never runs during server rendering.
  const { steps, returning } = useMemo(() => {
    if (!ready || dismissed) return { steps: [] as TourStep[], returning: false }
    if (replay) return { steps: TOUR_STEPS, returning: false }
    const seen = readSeenVersion()
    if (seen !== null && seen >= TOUR_VERSION) return { steps: [] as TourStep[], returning: false }
    return { steps: stepsFor(seen ?? 0), returning: seen !== null }
  }, [ready, replay, dismissed])

  if (steps.length === 0) return null

  const step = steps[index]
  const last = index === steps.length - 1

  function close() {
    markTourSeen()
    setDismissed(true)
    onClose?.()
  }

  function go(href: string) {
    close()
    router.push(href)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={t('common.tour.ariaLabel')}>
      <div className="w-full max-w-[480px] rounded-t-3xl bg-white px-6 pb-8 pt-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {returning ? t('common.tour.whatsNew') : ''}{index + 1} / {steps.length}
          </span>
          <button onClick={close} className="text-xs text-gray-400 underline">{t('common.tour.skip')}</button>
        </div>

        <div className="flex flex-col items-center text-center">
          <CatMascot mood={step.mood} size={96} />
          <h2 className="mt-3 text-lg font-bold">{stepText(step, 'title')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">{stepText(step, 'body')}</p>
          {step.href && (
            <button onClick={() => go(step.href!)} className="mt-3 text-sm font-medium underline">
              {stepText(step, 'hrefLabel')}
            </button>
          )}
        </div>

        <div className="mt-5 flex justify-center gap-1.5" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-black' : 'w-1.5 bg-gray-200'}`} />
          ))}
        </div>

        <div className="mt-5 flex gap-3">
          {index > 0 && (
            <button onClick={() => setIndex(index - 1)} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm">
              {t('common.tour.prev')}
            </button>
          )}
          <button
            onClick={() => (last ? close() : setIndex(index + 1))}
            className="flex-1 rounded-xl bg-black py-3 text-sm font-medium text-white"
          >
            {last ? t('common.tour.done') : t('common.tour.next')}
          </button>
        </div>
      </div>
    </div>
  )
}
