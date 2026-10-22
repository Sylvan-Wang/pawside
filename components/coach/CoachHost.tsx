'use client'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import CatMascot from '@/components/CatMascot'
import { shouldShowCoach } from '@/lib/coach-chat/client'

// The panel is only fetched when someone opens it.
const CoachPanel = dynamic(() => import('./CoachPanel'), { ssr: false })

const CACHE_KEY = 'pawside_coach_enabled'
const CACHE_MS = 10 * 60 * 1000

function readCache(): boolean | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { value, at } = JSON.parse(raw) as { value: boolean; at: number }
    return Date.now() - at < CACHE_MS ? value : null
  } catch {
    return null
  }
}

/**
 * The floating cat. Mounted once in the root layout; it renders nothing unless
 * the page is one where logging happens AND the server says this user has the
 * assistant. The server enforces access on every endpoint regardless.
 */
export default function CoachHost() {
  const pathname = usePathname()
  const visible = shouldShowCoach(pathname)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!visible || enabled !== null) return
    const cached = readCache()
    if (cached !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnabled(cached)
      return
    }
    let cancelled = false
    fetch('/api/coach/status')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: { enabled?: boolean } } | null) => {
        if (cancelled) return
        const value = payload?.data?.enabled === true
        setEnabled(value)
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ value, at: Date.now() })) } catch { /* private mode */ }
      })
      .catch(() => { if (!cancelled) setEnabled(false) })
    return () => { cancelled = true }
  }, [visible, enabled])

  // Leaving a page where the assistant is allowed closes it (e.g. starting a workout).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!visible) setOpen(false)
  }, [visible])

  if (!visible || enabled !== true) return null

  return (
    <>
      {/* Room at the end of every page so the floating cat never sits on its last line. */}
      <div aria-hidden="true" className="h-16" />
      <div className="pointer-events-none fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2">
        <button
          ref={launcher}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="打开小爪"
          className="pointer-events-auto absolute bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 flex h-12 w-12 items-center justify-center rounded-full border border-gray-100 bg-white shadow-lg active:scale-95"
        >
          <CatMascot mood="peek" size={36} />
        </button>
      </div>
      {open && (
        <CoachPanel
          onClose={() => {
            setOpen(false)
            launcher.current?.focus()
          }}
        />
      )}
    </>
  )
}
