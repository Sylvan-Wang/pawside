'use client'

import CatMascot from '@/components/CatMascot'
import { ACCOUNT_KEY, markTourSeen, readSeenVersion } from '@/lib/tour/storage'
import { TOUR_STEPS, TOUR_VERSION, type TourStep } from '@/lib/tour/steps'
import { decideTour, seenVersionFrom } from '@/lib/tour/decide'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { translate, type MessageKey } from '@/lib/i18n'
import { useLocale } from '@/lib/i18n/use-locale'

/**
 * Walkthrough sheet. Mounted on Home for signed-in users who finished onboarding.
 * - new account (lib/tour/decide.ts) that never saw it: all steps
 * - returning user: only steps whose feature launched today
 * - `replay`: all steps, regardless of what was seen (used by Settings)
 * What was seen is stored both in this browser and on the account.
 */
/** Remember the current version in this browser and on the account. Failures are ignored. */
async function recordSeen() {
  markTourSeen()
  try {
    await createClient().auth.updateUser({ data: { [ACCOUNT_KEY]: TOUR_VERSION } })
  } catch {
    // worst case: another device decides again, and an old account still sees nothing
  }
}

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

  const [decided, setDecided] = useState<{ steps: TourStep[]; returning: boolean }>({ steps: [], returning: false })

  // `ready` only turns true after Home has loaded client-side, so localStorage and
  // the auth session are only read in the browser.
  useEffect(() => {
    if (!ready || dismissed || replay) return
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }))
      const user = data.session?.user ?? null
      if (!user || cancelled) return
      const decision = decideTour({
        seen: seenVersionFrom(readSeenVersion(), user.user_metadata?.[ACCOUNT_KEY]),
        accountCreatedAt: user.created_at ?? null,
        now: new Date(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      if (decision.markSeenSilently) { void recordSeen(); return }
      if (!cancelled) setDecided({ steps: decision.steps, returning: decision.returning })
    })()
    return () => { cancelled = true }
  }, [ready, replay, dismissed])

  const steps = dismissed || !ready ? [] : replay ? TOUR_STEPS : decided.steps
  const returning = replay ? false : decided.returning

  if (steps.length === 0) return null

  const step = steps[index]
  const last = index === steps.length - 1

  function close() {
    if (!replay) void recordSeen()
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
