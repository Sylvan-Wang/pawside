import type { SupabaseClient } from '@supabase/supabase-js'
import { replaceFoodLogV2, saveFoodLogV2 } from '../nutrition/persistence'
import { invalidateDayDerivedCache } from '../utils'
import { isExpired } from './cards'
import { toFoodInputs } from './meal'
import { getDraft, transitionDraft } from './store'
import type { DraftRow, MealDraftPayload } from './types'
import { commitWeight } from './weight'
import { commitWorkout } from './workout'

/**
 * Confirming a card (Patch §5). The only place chat data becomes a record.
 *
 * Guarantees:
 *  - It commits the payload STORED on the draft, never anything the browser sent.
 *  - One request id per draft: a repeated confirm, a retry after a network error,
 *    or a second tab all resolve to the same record.
 *  - A draft moves proposed -> committing -> saved through conditional updates,
 *    so two concurrent confirms cannot both write.
 *  - A write that may or may not have happened is `outcome_unknown`, never a
 *    guessed success or failure; confirming again re-checks it.
 */

export type CommitOutcome =
  | { status: 'saved'; draft: DraftRow; idempotent: boolean; affectedDates: string[] }
  | { status: 'already_saved'; draft: DraftRow }
  | { status: 'not_found' }
  | { status: 'not_confirmable'; draft: DraftRow }
  | { status: 'stale'; draft: DraftRow }
  | { status: 'expired'; draft: DraftRow }
  | { status: 'in_progress'; draft: DraftRow }
  | { status: 'conflict'; draft: DraftRow }
  | { status: 'failed'; draft: DraftRow; code: string }
  | { status: 'outcome_unknown'; draft: DraftRow }

/** A "committing" claim older than this is treated as an interrupted attempt and re-checked. */
const STALE_COMMITTING_MS = 60_000

type ErrorLike = { code?: string; message?: string }

/** Database/PostgREST errors carry a code and mean the statement did not commit. Anything else may have. */
function isDefinitiveDatabaseError(error: ErrorLike): boolean {
  return typeof error.code === 'string' && /^([0-9A-Z]{5}|PGRST\d+)$/.test(error.code)
}

function classify(error: ErrorLike): 'conflict' | 'missing' | 'invalid' | 'auth' | 'unknown' {
  if (!isDefinitiveDatabaseError(error)) return 'unknown'
  // PT409 is what replace_food_log_canonical_v2 raises (PostgREST hangs on 40001); 40001 kept for any older function.
  if (error.code === 'PT409' || error.code === '40001') return 'conflict'
  if (error.code === 'P0002') return 'missing'
  if (error.code === '22023' || error.code === '23514' || error.code === '23505') return 'invalid'
  if (error.code === '42501' || error.code?.startsWith('PGRST3')) return 'auth'
  return 'unknown'
}

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a - b) < 0.01
}

/**
 * After an interrupted edit: does the saved meal already look exactly like the
 * draft? If so the earlier attempt did succeed and this is not a conflict.
 */
async function savedMealMatchesDraft(supabase: SupabaseClient, userId: string, draft: DraftRow): Promise<boolean> {
  if (!draft.target_record_id) return false
  const payload = draft.payload as MealDraftPayload
  const { data, error } = await supabase
    .from('user_food_log_items')
    .select('food_name_raw,weight_g,energy_kcal,user_food_logs!inner(user_id)')
    .eq('food_log_id', draft.target_record_id)
    .eq('user_food_logs.user_id', userId)
    .neq('status', 'rejected')
    .retry(false)
  if (error || !data || data.length !== payload.items.length) return false
  const remaining = [...data]
  for (const item of payload.items) {
    const index = remaining.findIndex((row) =>
      row.food_name_raw === item.name_raw
      && sameNumber(row.weight_g === null ? null : Number(row.weight_g), item.weight_g)
      && sameNumber(row.energy_kcal === null ? null : Number(row.energy_kcal), item.nutrition?.energy_kcal ?? null))
    if (index === -1) return false
    remaining.splice(index, 1)
  }
  return true
}

/**
 * Did this draft's write land? The write's own request id is the receipt:
 * a new meal / workout / weight carries it in the row; an edit is recognised
 * by the record now looking like the draft. true/false = we could look;
 * null = we could not (still offline), which stays "outcome unknown".
 */
async function receiptExists(supabase: SupabaseClient, userId: string, draft: DraftRow): Promise<boolean | null> {
  try {
    if (draft.kind === 'meal_edit') return await savedMealMatchesDraft(supabase, userId, draft)
    const lookup = draft.kind === 'meal'
      ? supabase.from('user_food_logs').select('id').eq('user_id', userId).eq('client_request_id', draft.request_id)
      : draft.kind === 'workout'
        ? supabase.from('workout_logs').select('id').eq('user_id', userId).eq('client_request_id', draft.request_id)
        : supabase.from('body_metric_write_receipts').select('request_id').eq('user_id', userId).eq('request_id', draft.request_id)
    // One attempt: supabase-js would otherwise retry a failed GET for several seconds while the user waits.
    const { data, error } = await lookup.limit(1).retry(false)
    if (error) return null
    return (data ?? []).length > 0
  } catch {
    return null
  }
}

async function reload(supabase: SupabaseClient, userId: string, draft: DraftRow): Promise<DraftRow> {
  return (await getDraft(supabase, userId, draft.id)) ?? draft
}

export async function commitDraft(input: {
  supabase: SupabaseClient
  userId: string
  draftId: string
  expectedVersion: number
  timeZone: string
  now?: Date
}): Promise<CommitOutcome> {
  const { supabase, userId } = input
  const now = input.now ?? new Date()

  let draft = await getDraft(supabase, userId, input.draftId)
  if (!draft) return { status: 'not_found' }
  if (draft.status === 'saved') return { status: 'already_saved', draft }
  if (['superseded', 'cancelled', 'failed', 'needs_clarification'].includes(draft.status)) {
    return { status: 'not_confirmable', draft }
  }
  if (draft.version !== input.expectedVersion) return { status: 'stale', draft }
  if (isExpired(draft, now)) return { status: 'expired', draft }

  if (draft.status === 'committing') {
    const age = now.getTime() - new Date(draft.updated_at).getTime()
    if (age < STALE_COMMITTING_MS) return { status: 'in_progress', draft }
    const reopened = await transitionDraft(supabase, { userId, draftId: draft.id, from: ['committing'], to: 'outcome_unknown' })
    draft = reopened ?? (await reload(supabase, userId, draft))
  }

  const claimed = await transitionDraft(supabase, {
    userId,
    draftId: draft.id,
    from: ['proposed', 'outcome_unknown'],
    to: 'committing',
    version: draft.version,
  })
  if (!claimed) {
    // Someone else (a second tab, a double tap) got there first. Report what is true now.
    const current = await reload(supabase, userId, draft)
    if (current.status === 'saved') return { status: 'already_saved', draft: current }
    if (current.status === 'committing') return { status: 'in_progress', draft: current }
    return { status: 'not_confirmable', draft: current }
  }

  try {
    const outcome = await write(supabase, userId, claimed, input.timeZone)
    const saved = await transitionDraft(supabase, {
      userId,
      draftId: claimed.id,
      from: ['committing'],
      to: 'saved',
      result: outcome.result,
    })
    return {
      status: 'saved',
      draft: saved ?? (await reload(supabase, userId, claimed)),
      idempotent: outcome.idempotent,
      affectedDates: outcome.affectedDates,
    }
  } catch (reason) {
    const error = reason as ErrorLike
    const kind = classify(error)

    if (kind === 'conflict' || (claimed.kind === 'meal_edit' && kind === 'unknown')) {
      // For an edit, "the record changed" is only a conflict if it does not already
      // look like our draft (an earlier attempt of this same edit may have landed).
      if (claimed.kind === 'meal_edit' && await savedMealMatchesDraft(supabase, userId, claimed)) {
        const saved = await transitionDraft(supabase, {
          userId, draftId: claimed.id, from: ['committing'], to: 'saved',
          result: { food_log_id: claimed.target_record_id, reconciled: true },
        })
        return { status: 'saved', draft: saved ?? (await reload(supabase, userId, claimed)), idempotent: true, affectedDates: [(claimed.payload as MealDraftPayload).date] }
      }
      if (kind === 'conflict') {
        const failed = await transitionDraft(supabase, { userId, draftId: claimed.id, from: ['committing'], to: 'failed', errorCode: 'conflict' })
        return { status: 'conflict', draft: failed ?? (await reload(supabase, userId, claimed)) }
      }
    }

    if (kind === 'auth') {
      const back = await transitionDraft(supabase, { userId, draftId: claimed.id, from: ['committing'], to: 'proposed', errorCode: 'auth' })
      return { status: 'failed', draft: back ?? (await reload(supabase, userId, claimed)), code: 'auth' }
    }
    if (kind === 'missing' || kind === 'invalid') {
      const code = kind === 'missing' ? 'target_missing' : 'invalid'
      const failed = await transitionDraft(supabase, { userId, draftId: claimed.id, from: ['committing'], to: 'failed', errorCode: code })
      return { status: 'failed', draft: failed ?? (await reload(supabase, userId, claimed)), code }
    }

    // We cannot tell from the error whether the database applied the write. Look it up.
    const landed = await receiptExists(supabase, userId, claimed)
    if (landed === true) {
      const saved = await transitionDraft(supabase, {
        userId, draftId: claimed.id, from: ['committing'], to: 'saved', result: await receiptResult(supabase, userId, claimed),
      })
      return { status: 'saved', draft: saved ?? (await reload(supabase, userId, claimed)), idempotent: true, affectedDates: [(claimed.payload as { date: string }).date] }
    }
    if (landed === false) {
      // Nothing was written. The card goes back to waiting; the same request id makes a late
      // arrival of the first attempt harmless.
      const back = await transitionDraft(supabase, { userId, draftId: claimed.id, from: ['committing'], to: 'proposed', errorCode: 'network' })
      return { status: 'failed', draft: back ?? (await reload(supabase, userId, claimed)), code: 'network' }
    }
    const unknown = await transitionDraft(supabase, { userId, draftId: claimed.id, from: ['committing'], to: 'outcome_unknown', errorCode: 'unknown' })
    return { status: 'outcome_unknown', draft: unknown ?? (await reload(supabase, userId, claimed)) }
  }
}

/** The ids of the record an interrupted write left behind, for the draft's receipt. */
async function receiptResult(supabase: SupabaseClient, userId: string, draft: DraftRow): Promise<Record<string, unknown>> {
  const date = (draft.payload as { date: string }).date
  try {
    if (draft.kind === 'meal_edit') return { food_log_id: draft.target_record_id, date, reconciled: true }
    const table = draft.kind === 'meal' ? 'user_food_logs' : draft.kind === 'workout' ? 'workout_logs' : 'body_metric_write_receipts'
    const idColumn = draft.kind === 'weight' ? 'body_metric_id' : 'id'
    const requestColumn = draft.kind === 'weight' ? 'request_id' : 'client_request_id'
    const { data } = await supabase.from(table).select(idColumn).eq('user_id', userId).eq(requestColumn, draft.request_id).limit(1)
    const id = (data?.[0] as unknown as Record<string, string> | undefined)?.[idColumn] ?? null
    const key = draft.kind === 'meal' ? 'food_log_id' : draft.kind === 'workout' ? 'workout_log_id' : 'body_metric_id'
    return { [key]: id, date, reconciled: true }
  } catch {
    return { date, reconciled: true }
  }
}

async function write(
  supabase: SupabaseClient,
  userId: string,
  draft: DraftRow,
  timeZone: string,
): Promise<{ result: Record<string, unknown>; idempotent: boolean; affectedDates: string[] }> {
  if (draft.kind === 'meal') {
    const payload = draft.payload as MealDraftPayload
    const saved = await saveFoodLogV2(supabase, {
      userId,
      requestId: draft.request_id,
      logDate: payload.date,
      mealType: payload.meal_type,
      rawInputText: payload.raw_text || null,
      notes: null,
      items: toFoodInputs(payload.items),
      inputMode: 'ai_assisted',
    })
    await invalidateDayDerivedCache(supabase, userId, payload.date)
    return {
      result: { food_log_id: saved.foodLogId, legacy_food_log_id: saved.legacyFoodLogId, date: payload.date },
      idempotent: saved.idempotent,
      affectedDates: [payload.date],
    }
  }

  if (draft.kind === 'meal_edit') {
    const payload = draft.payload as MealDraftPayload
    if (!draft.target_record_id) throw Object.assign(new Error('missing target'), { code: 'P0002' })
    const replaced = await replaceFoodLogV2(supabase, {
      userId,
      foodLogId: draft.target_record_id,
      expectedUpdatedAt: draft.target_updated_at,
      logDate: payload.date,
      mealType: payload.meal_type,
      rawInputText: payload.raw_text || null,
      notes: payload.notes ?? null,
      items: toFoodInputs(payload.items),
    })
    await invalidateDayDerivedCache(supabase, userId, payload.date)
    return {
      result: { food_log_id: replaced.foodLogId, legacy_food_log_id: replaced.legacyFoodLogId, date: payload.date, updated_at: replaced.updatedAt },
      idempotent: false,
      affectedDates: [payload.date],
    }
  }

  if (draft.kind === 'workout') {
    const saved = await commitWorkout(supabase, userId, draft)
    return { result: { workout_log_id: saved.workoutLogId, date: saved.date }, idempotent: saved.idempotent, affectedDates: [saved.date] }
  }

  const saved = await commitWeight(supabase, userId, draft, timeZone)
  return { result: { body_metric_id: saved.bodyMetricId, date: saved.date }, idempotent: saved.idempotent, affectedDates: [saved.date] }
}

export async function cancelDraft(input: {
  supabase: SupabaseClient
  userId: string
  draftId: string
}): Promise<{ status: 'cancelled' | 'not_found' | 'not_cancellable'; draft?: DraftRow }> {
  const draft = await getDraft(input.supabase, input.userId, input.draftId)
  if (!draft) return { status: 'not_found' }
  if (draft.status === 'cancelled') return { status: 'cancelled', draft }
  const cancelled = await transitionDraft(input.supabase, {
    userId: input.userId,
    draftId: draft.id,
    from: ['proposed', 'needs_clarification'],
    to: 'cancelled',
  })
  if (!cancelled) return { status: 'not_cancellable', draft: await reload(input.supabase, input.userId, draft) }
  return { status: 'cancelled', draft: cancelled }
}
