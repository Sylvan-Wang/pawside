'use client'

import type { ExerciseMedia } from '@/lib/exercise-media'
import { useEffect, useState } from 'react'

interface ExerciseMotionProps {
  name: string
  media: ExerciseMedia
  mode?: 'carousel' | 'steps'
  compact?: boolean
  animate?: boolean
  loading?: 'eager' | 'lazy'
}

export default function ExerciseMotion({
  name,
  media,
  mode = 'carousel',
  compact = false,
  animate = true,
  loading = 'lazy',
}: ExerciseMotionProps) {
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!animate || mode === 'steps' || reducedMotion || media.frames.length < 2) return

    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % media.frames.length)
    }, 700)

    return () => window.clearInterval(timer)
  }, [animate, media.frames.length, mode])

  const frame = media.frames[frameIndex]

  return (
    <figure className="mt-3 rounded-xl border border-white/10 bg-neutral-800 p-3">
      {mode === 'steps' ? (
        <div className="grid grid-cols-3 gap-2">
          {media.frames.map((item) => (
            // The source host is fixed by the server-side package helper.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.index}
              src={item.url}
              width={item.width}
              height={item.height}
              loading={loading}
              decoding="async"
              alt={name + '动作示意，第 ' + item.index + ' 帧'}
              className="aspect-square w-full rounded-lg bg-neutral-800 object-contain"
            />
          ))}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frame.url}
          width={frame.width}
          height={frame.height}
          loading={loading}
          decoding="async"
          alt={name + '动作示意，第 ' + frame.index + ' 帧'}
          className={compact
            ? 'mx-auto aspect-square w-full max-w-40 object-contain'
            : 'mx-auto aspect-square w-full max-w-56 object-contain'
          }
        />
      )}
      {/*
        Patch B · B2: the per-clip attribution/license/source line was pure
        clutter for a user ("固定的小字对用户没用"). CC BY-SA 4.0 still
        requires attribution, so it moved to Settings → 关于
        (lib/exercise-media.ts's WORKOUT_GUIDE_* constants), stated once for
        the whole media set instead of repeated under every exercise.
      */}
      <figcaption className="mt-2 text-[11px] leading-5 text-neutral-300">
        <span>{media.provider_name}</span>
        {media.mapping_status === 'candidate' && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">素材待动作审核</span>
        )}
      </figcaption>
    </figure>
  )
}
