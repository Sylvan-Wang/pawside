'use client'

import { useEffect, useState } from 'react'

/**
 * The app's exercise illustration: three pose frames cycled every 0.7 s on a dark
 * panel (same behaviour as components/workout/ExerciseMotion.tsx). Frames are
 * self-hosted under /welcome-assets so the public site makes no third-party request.
 * Artwork: Everkinetic / Bryl Lim, CC BY-SA 4.0 (credited in the site footer).
 * Reduced motion: shows the first frame only.
 */
export default function ExerciseFrames({
  slug,
  name,
  caption,
  size = 150,
}: {
  slug: string
  name: string
  caption: string
  size?: number
}) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % 3), 700)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <figure style={{ margin: '10px 0 0', borderRadius: 12, border: '1px solid rgba(255,255,255,.1)', background: '#262626', padding: 10 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/welcome-assets/exercises/${slug}/frame-${index + 1}.png`}
        width={512}
        height={512}
        alt={`${name}动作示意，第 ${index + 1} 帧`}
        decoding="async"
        style={{ display: 'block', margin: '0 auto', width: '100%', maxWidth: size, aspectRatio: '1 / 1', objectFit: 'contain' }}
      />
      <figcaption style={{ marginTop: 6, fontSize: 11, lineHeight: 1.6, color: '#d4d4d4' }}>{caption}</figcaption>
    </figure>
  )
}
