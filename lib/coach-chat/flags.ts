import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Who can use the chat (Patch §2 / §12).
 *
 *  - PAWSIDE_COACH_CHAT=0|false|off     kill switch for everyone (no deploy needed)
 *  - app_features / user_features       per-user grant: feature key `coach_chat`
 *  - PAWSIDE_COACH_CHAT_MEALS|WORKOUTS|WEIGHT=0   turn one part off, keep the rest
 *
 * Turning anything off never deletes data; records already saved stay where
 * they are and the manual pages keep working.
 */

function envOff(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  return raw === '0' || raw === 'false' || raw === 'off'
}

export function coachChatKilled(): boolean {
  return envOff('PAWSIDE_COACH_CHAT')
}

export function coachChatFeatures() {
  return {
    meals: !envOff('PAWSIDE_COACH_CHAT_MEALS'),
    workouts: !envOff('PAWSIDE_COACH_CHAT_WORKOUTS'),
    weight: !envOff('PAWSIDE_COACH_CHAT_WEIGHT'),
  }
}

/** True when the kill switch is off AND this user has been granted `coach_chat`. */
export async function coachChatEnabledFor(supabase: SupabaseClient): Promise<boolean> {
  if (coachChatKilled()) return false
  const { data, error } = await supabase.rpc('feature_enabled', { p_key: 'coach_chat' })
  return !error && data === true
}
