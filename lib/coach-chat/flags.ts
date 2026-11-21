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

/**
 * 「识别这一餐」 sends meal photos to the model, so it is OFF unless
 * PAWSIDE_PHOTO_RECOGNITION=1|true|on. Turn it on only after `npm run photo:check`
 * shows the configured model reads images, and the privacy page says so.
 */
export function photoRecognitionEnabled(): boolean {
  const raw = process.env.PAWSIDE_PHOTO_RECOGNITION?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'on'
}
