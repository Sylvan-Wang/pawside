'use client'

import { useEffect, useRef } from 'react'

/**
 * Fades a block in once as it scrolls into view. Content is in the HTML from the
 * start: the hidden state is only applied after hydration, and only to blocks
 * that begin below the fold, so no-JS visitors and reduced-motion users see
 * everything immediately.
 */
export default function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const rect = element.getBoundingClientRect()
    if (reduce || rect.top < window.innerHeight * 0.9 || typeof IntersectionObserver === 'undefined') return
    element.classList.add('reveal-init')
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        element.classList.add('is-in')
        observer.disconnect()
      }
    }, { threshold: 0.12 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className={className}>{children}</div>
}
