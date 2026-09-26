import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Pawside — scoped AI feedback with provenance.
 *
 * Authority:
 *   Product §14  — 👍/👎 may only ship when the backend can also store
 *                  feedback_content_id, scope_id, prompt_version,
 *                  model_version, input_snapshot_version, user_rating, timestamp
 *   AI Patch §32 — persistence contract
 *   AI Patch §33 — a rating is an evaluation signal, never online training;
 *                  UI must not imply the model learns immediately (AC-AI13)
 *
 * This deliberately does NOT reuse `ai_generated_content.feedback`, which is
 * unique per (user_id, content_type, target_date) and therefore cannot hold a
 * rating per workout session (Product §12.1 / AC-P09).
 */

export type FeedbackContentType =
  | 'workout_session_feedback'
  | 'meal_feedback'
  | 'daily_review'
  | 'weekly_review'

export type FeedbackScope = 'session' | 'meal' | 'day' | 'week'

export type FeedbackRating = 'liked' | 'disliked'

export interface FeedbackRecordInput {
  userId: string
  contentType: FeedbackContentType
  scope: FeedbackScope
  /** Session id / food log id / date / week start. */
  scopeId: string
  rating: FeedbackRating | null
  inputSnapshotId?: string | null
  promptVersion?: string | null
  model?: string | null
  modelVersion?: string | null
  evidenceRegistryVersion?: string | null
  outputJson?: unknown
}

export interface FeedbackRecord {
  content_type: FeedbackContentType
  scope: FeedbackScope
  scope_id: string
  rating: FeedbackRating | null
  prompt_version: string | null
  model: string | null
  input_snapshot_id: string | null
}

/**
 * Product §14 gate: a rating may only be accepted when the provenance needed to
 * interpret it exists. Without this, a thumbs-down would be un-actionable —
 * "pretty but with no product loop", which §14 explicitly rejects.
 */
export function canAcceptRating(input: {
  promptVersion?: string | null
  model?: string | null
  inputSnapshotId?: string | null
}): { allowed: boolean; missing: string[] } {
  const missing: string[] = []
  if (!input.promptVersion) missing.push('prompt_version')
  if (!input.model) missing.push('model')
  // An input snapshot is what makes a rating reproducible for eval (AI Patch §33).
  if (!input.inputSnapshotId) missing.push('input_snapshot_id')
  return { allowed: missing.length === 0, missing }
}

export async function upsertFeedback(
  supabase: SupabaseClient,
  input: FeedbackRecordInput,
): Promise<void> {
  const { error } = await supabase
    .from('ai_feedback')
    .upsert({
      user_id: input.userId,
      content_type: input.contentType,
      scope: input.scope,
      scope_id: input.scopeId,
      rating: input.rating,
      input_snapshot_id: input.inputSnapshotId ?? null,
      prompt_version: input.promptVersion ?? null,
      model: input.model ?? null,
      model_version: input.modelVersion ?? null,
      evidence_registry_version: input.evidenceRegistryVersion ?? null,
      output_json: input.outputJson ?? null,
      rated_at: input.rating === null ? null : new Date().toISOString(),
    }, { onConflict: 'user_id,content_type,scope_id' })

  if (error) throw new Error(error.message)
}

/** Loads the current rating for one rated entity, or null when not rated. */
export async function loadFeedback(
  supabase: SupabaseClient,
  userId: string,
  contentType: FeedbackContentType,
  scopeId: string,
): Promise<FeedbackRecord | null> {
  const { data, error } = await supabase
    .from('ai_feedback')
    .select('content_type,scope,scope_id,rating,prompt_version,model,input_snapshot_id')
    .eq('user_id', userId)
    .eq('content_type', contentType)
    .eq('scope_id', scopeId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return {
    content_type: data.content_type,
    scope: data.scope,
    scope_id: data.scope_id,
    rating: data.rating,
    prompt_version: data.prompt_version,
    model: data.model,
    input_snapshot_id: data.input_snapshot_id,
  }
}

/**
 * Product §14 / AI Patch §33: the copy a 👍/👎 control may show.
 *
 * It must not claim the model is being trained.
 */
export const FEEDBACK_UI_COPY = {
  prompt: '这次反馈有帮助吗？',
  liked: '有帮助',
  disliked: '没帮助',
  /** Shown after rating; deliberately describes evaluation, not learning. */
  acknowledged: '已记录你的反馈，用于我们评估和改进内容质量。',
} as const
