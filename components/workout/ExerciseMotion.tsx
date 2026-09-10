'use client'

import type { ExerciseMedia } from '@/lib/exercise-media'
import { useEffect, useState } from 'react'

interface ExerciseMotionProps {
  name: string
  media: ExerciseMedia
  mode?: 'carousel' | 'steps'
  compact?: boolean
}

export default function ExerciseMotion({
  name,
  media,
  mode = 'carousel',
  compact = false,
}: ExerciseMotionProps) {
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (mode === 'steps' || reducedMotion || media.frames.length < 2) return

    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % media.frames.length)
    }, 700)

    return () => window.clearInterval(timer)
  }, [media.frames.length, mode])

  const frame = media.frames[frameIndex]

  return (
    <figure className="mt-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
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
              alt={name + '动作示意，第 ' + item.index + ' 帧'}
              className="aspect-square w-full rounded-lg bg-white object-contain"
            />
          ))}
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={frame.url}
          width={frame.width}
          height={frame.height}
          alt={name + '动作示意，第 ' + frame.index + ' 帧'}
          className={compact
            ? 'mx-auto aspect-square w-full max-w-40 object-contain'
            : 'mx-auto aspect-square w-full max-w-56 object-contain'
          }
        />
      )}
      <figcaption className="mt-2 text-[11px] leading-5 text-gray-500">
        <span>{media.provider_name}</span>
        {media.mapping_status === 'candidate' && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">素材待动作审核</span>
        )}
        <span className={compact ? 'sr-only' : 'block'}>
          {media.attribution.text}{' '}
          <a className="underline" href={media.attribution.license_url} target="_blank" rel="noreferrer">
            {media.attribution.license}
          </a>
          {' · '}
          <a className="underline" href={media.source_url} target="_blank" rel="noreferrer">
            素材来源
          </a>
        </span>
      </figcaption>
    </figure>
  )
}
