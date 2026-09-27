import { getAssetUrl, getExercise } from '@bryllim/workout-guide'

export const WORKOUT_GUIDE_PROVIDER = '@bryllim/workout-guide'
export const WORKOUT_GUIDE_VERSION = '1.0.0'
export const WORKOUT_GUIDE_LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/'

/**
 * Patch B · B2: every exercise mapping seeded so far carries this exact same
 * attribution text (see supabase/migrations/20260906000200_workout_guide_media_foundation.sql
 * and 20260909000500_workout_guide_method_catalog.sql) — one creator, one
 * license, for the whole media set. Settings → 关于 states it once here
 * instead of the per-exercise `ExerciseMotion` caption this replaced.
 * If a future mapping ever uses different wording, source it from that row's
 * own `ExerciseMedia.attribution` instead of this constant.
 */
export const WORKOUT_GUIDE_ATTRIBUTION_TEXT =
  'Original exercise artwork by Everkinetic, expanded by Bryl Lim, licensed under CC BY-SA 4.0. 部分素材经过修改。'
export const WORKOUT_GUIDE_GENERAL_SOURCE_URL = 'https://bryllim.github.io/workout-guide/'

export type ExerciseMediaMappingStatus = 'candidate' | 'confirmed' | 'rejected'

export interface ExerciseMediaMapping {
  provider: string
  external_slug: string
  source_version: string
  license: string
  attribution: string
  source_url: string | null
  mapping_status: ExerciseMediaMappingStatus
  mapping_notes: string | null
}

export interface ExerciseMediaFrame {
  index: 1 | 2 | 3
  url: string
  width: 512
  height: 512
}

export interface ExerciseMedia {
  provider: typeof WORKOUT_GUIDE_PROVIDER
  provider_version: typeof WORKOUT_GUIDE_VERSION
  external_slug: string
  provider_name: string
  mapping_status: ExerciseMediaMappingStatus
  mapping_notes: string | null
  source_url: string
  frames: ExerciseMediaFrame[]
  attribution: {
    text: string
    creator_url: string
    license: 'CC BY-SA 4.0'
    license_url: typeof WORKOUT_GUIDE_LICENSE_URL
  }
}

export function buildWorkoutGuideMedia(mapping: ExerciseMediaMapping): ExerciseMedia | null {
  if (
    mapping.provider !== WORKOUT_GUIDE_PROVIDER ||
    mapping.source_version !== WORKOUT_GUIDE_VERSION ||
    mapping.mapping_status === 'rejected'
  ) {
    return null
  }

  const exercise = getExercise(mapping.external_slug)
  if (!exercise) return null

  const frames = exercise.frames.flatMap((frame) => {
    const url = getAssetUrl(exercise.slug, frame.index, { version: WORKOUT_GUIDE_VERSION })
    return url
      ? [{ index: frame.index, url, width: frame.width, height: frame.height }]
      : []
  })

  if (frames.length !== 3) return null

  return {
    provider: WORKOUT_GUIDE_PROVIDER,
    provider_version: WORKOUT_GUIDE_VERSION,
    external_slug: exercise.slug,
    provider_name: exercise.name,
    mapping_status: mapping.mapping_status,
    mapping_notes: mapping.mapping_notes,
    source_url: mapping.source_url || `https://bryllim.github.io/workout-guide/exercises/${exercise.slug}/`,
    frames,
    attribution: {
      text: mapping.attribution,
      creator_url: exercise.attribution.creatorUrl,
      license: 'CC BY-SA 4.0',
      license_url: WORKOUT_GUIDE_LICENSE_URL,
    },
  }
}
