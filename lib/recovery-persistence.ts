import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecoveryCheckin } from './recovery'

/**
 * Pawside — Recovery V1 persistence.
 *
 * Product §7: at most one check-in per local natural day. Re-answering updates
 * the same row, and an explicit skip also counts so closing the app cannot
 * re-prompt.
 */

export interface SaveRecoveryCheckinInput {
  userId: string
  checkinDate: string
  sleepQuality: number | null
  postWorkoutRecovery: number | null
  skipped?: boolean
}

export async function loadRecoveryCheckin(
  supabase: SupabaseClient,
  userId: string,
  checkinDate: string,
): Promise<RecoveryCheckin | null> {
  const { data, error } = await supabase
    .from('recovery_checkins')
    .select('checkin_date,sleep_quality_self_report,post_workout_recovery_self_report,skipped')
    .eq('user_id', userId)
    .eq('checkin_date', checkinDate)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return {
    checkin_date: data.checkin_date,
    sleep_quality_self_report: data.sleep_quality_self_report,
    post_workout_recovery_self_report: data.post_workout_recovery_self_report,
    skipped: data.skipped,
  }
}

export async function saveRecoveryCheckin(
  supabase: SupabaseClient,
  input: SaveRecoveryCheckinInput,
): Promise<void> {
  const { error } = await supabase
    .from('recovery_checkins')
    .upsert({
      user_id: input.userId,
      checkin_date: input.checkinDate,
      // Product §27: unanswered stays null. Never substitute 3/5.
      sleep_quality_self_report: input.sleepQuality,
      post_workout_recovery_self_report: input.postWorkoutRecovery,
      skipped: input.skipped ?? false,
    }, { onConflict: 'user_id,checkin_date' })

  if (error) throw new Error(error.message)
}

/** Loads a date range for the weekly recovery trend (Product §23.4). */
export async function loadRecoveryRange(
  supabase: SupabaseClient,
  userId: string,
  startDate: string,
  endDate: string,
): Promise<RecoveryCheckin[]> {
  const { data, error } = await supabase
    .from('recovery_checkins')
    .select('checkin_date,sleep_quality_self_report,post_workout_recovery_self_report,skipped')
    .eq('user_id', userId)
    .gte('checkin_date', startDate)
    .lte('checkin_date', endDate)
    .order('checkin_date', { ascending: true })

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => ({
    checkin_date: row.checkin_date,
    sleep_quality_self_report: row.sleep_quality_self_report,
    post_workout_recovery_self_report: row.post_workout_recovery_self_report,
    skipped: row.skipped,
  }))
}
