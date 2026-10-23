import type { SupabaseClient } from '@supabase/supabase-js'
import { dateKeyInTimeZone } from '../utils'
import { buildCard } from './cards'
import { validTimeZone } from './dates'
import { getDrafts, type MessageRow } from './store'
import type { CardView, ChatMessageView } from './types'

/** Cards are read from the drafts as they are NOW, so a saved card shows as saved after a reload. */
export async function toMessageViews(
  supabase: SupabaseClient,
  userId: string,
  rows: MessageRow[],
  timeZone: string | null,
  now: Date = new Date(),
): Promise<ChatMessageView[]> {
  // Only used to word dates on cards ("今天" / "昨天"); falls back to UTC for that wording alone.
  const zone = validTimeZone(timeZone) ?? 'UTC'
  const today = dateKeyInTimeZone(now, zone)
  const ids = [...new Set(rows.flatMap((row) => row.cards.map((card) => card.draft_id)))]
  const drafts = new Map((await getDrafts(supabase, userId, ids)).map((draft) => [draft.id, draft]))

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    text: row.content,
    local_date: row.local_date,
    created_at: row.created_at,
    cards: row.cards
      .map((card) => drafts.get(card.draft_id))
      .filter((draft): draft is NonNullable<typeof draft> => draft !== undefined)
      .map((draft): CardView => buildCard(draft, now, today)),
  }))
}
