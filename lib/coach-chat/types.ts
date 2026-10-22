import type { DateSource, MealSlot } from './dates'
import type { PlanItem } from './schemas'

/**
 * Shapes stored in coach_drafts.payload and sent to the client as cards.
 * Everything a card shows is derived on the server from these; the browser never
 * sends content back, only "confirm draft X at version V".
 */

export type DraftKind = 'meal' | 'meal_edit' | 'workout' | 'weight'
export type DraftStatus =
  | 'needs_clarification'
  | 'proposed'
  | 'committing'
  | 'saved'
  | 'superseded'
  | 'cancelled'
  | 'failed'
  | 'outcome_unknown'

export type ItemResolution = 'user_memory' | 'canonical_db' | 'candidate_cache' | 'ai_estimate' | 'user_override' | 'unresolved'
export type WeightBasis = PlanItem['gramsBasis'] | 'portion_template' | 'kept' | 'scaled'
export type NutritionStatus = 'resolved' | 'estimated' | 'unknown'

export interface Per100g {
  basis_type: 'per_100g'
  energy_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
  fiber_g?: number | null
}

export interface Macros {
  energy_kcal: number | null
  protein_g: number | null
  carb_g: number | null
  fat_g: number | null
}

export interface MealDraftItem {
  /** The user's wording, kept for display and for matching later edits. */
  name_raw: string
  /** The food it was matched to (display only), if any. */
  name_resolved: string | null
  amount_text: string | null
  /** What the user said, e.g. 1 + 碗. Stored on the item for history; grams are the source of truth. */
  quantity: number | null
  unit: string | null
  food_id: number | null
  resolution_source: ItemResolution
  source_ref_id: string | null
  /** Canonical/memory rows: a display snapshot (commit reloads). AI estimate: the provisional numbers. */
  per100g: Per100g | null
  weight_g: number | null
  weight_basis: WeightBasis
  nutrition: Macros | null
  nutrition_status: NutritionStatus
  /** Set when the stored numbers are fixed actuals (an earlier manual entry), not per-100g based. */
  fixed_actuals: boolean
  caveat: string | null
}

export interface MealTotals {
  /** Sum of the items whose nutrition is known. Unknown items are excluded and counted below. */
  known: Macros
  item_count: number
  unknown_item_count: number
  estimated_item_count: number
}

export interface MealDraftPayload {
  v: 1
  date: string
  date_source: DateSource
  meal_type: MealSlot
  meal_type_source: 'user' | 'inferred' | 'kept'
  /** The user's message; becomes user_food_logs.raw_input_text. */
  raw_text: string
  items: MealDraftItem[]
  totals: MealTotals
  warnings: string[]
  /** meal_edit only: what the record looked like before this edit, for the card. */
  before?: { summary: string }
  /** meal_edit only: the saved record's note, carried through the replace unchanged. */
  notes?: string | null
}

export interface WorkoutDraftPayload {
  v: 1
  date: string
  date_source: DateSource
  workout_type: string
  minutes: number
  calories: number | null
  notes: string | null
  raw_text: string
  /** Same-day activity that looks similar. A prompt for the user, never a block. */
  possible_duplicates: Array<{ id: string; label: string; source: 'method' | 'free' }>
}

export interface WeightDraftPayload {
  v: 1
  date: string
  date_source: DateSource
  weight_kg: number
  shown_value: number
  shown_unit: 'kg' | 'lb' | 'jin'
  unit_source: 'user' | 'profile'
  /** An existing weight for that day that this write replaces. */
  replaces_kg: number | null
  raw_text: string
}

/**
 * A needs_clarification draft: the question the assistant is waiting on. When the
 * server asked (date, meal slot, which meal to edit) it also keeps the already
 * understood task, so an answer completes it WITHOUT asking the model to re-read
 * the whole sentence.
 */
export interface ClarifyPayload {
  v: 1
  source: 'server' | 'model'
  about: 'date' | 'meal_type' | 'edit_target' | 'meal' | 'workout' | 'weight' | 'meal_edit'
  question: string
  options: Array<{ label: string; value: string }>
  pending_task: import('./schemas').PlanTask | null
  raw_text: string
}

export type DraftPayload = MealDraftPayload | WorkoutDraftPayload | WeightDraftPayload | ClarifyPayload

/** A question draft keeps its question payload for life, whatever status it ends in (answered, dropped, expired). */
export function isClarifyPayload(payload: DraftPayload): payload is ClarifyPayload {
  return typeof (payload as ClarifyPayload).question === 'string' && Array.isArray((payload as ClarifyPayload).options)
}

export interface DraftRow {
  id: string
  user_id: string
  conversation_id: string
  message_id: string | null
  kind: DraftKind
  status: DraftStatus
  version: number
  request_id: string
  payload: DraftPayload
  target_record_id: string | null
  target_updated_at: string | null
  supersedes_id: string | null
  clarifications_used: number
  result: Record<string, unknown> | null
  error_code: string | null
  expires_at: string
  created_at: string
  updated_at: string
}

export interface CardLine {
  text: string
  /** Short label such as 估算 / 营养待补, shown as a small badge. */
  badge?: string | null
}

/** What the client renders. Built from a DraftRow on the server (cards.ts). */
export interface CardView {
  draft_id: string
  /** Set while the assistant is waiting for an answer: shown as tappable replies. */
  question: { text: string; options: string[] } | null
  kind: DraftKind
  status: DraftStatus
  version: number
  title: string
  subtitle: string | null
  lines: CardLine[]
  total: string | null
  notes: string[]
  can_confirm: boolean
  can_cancel: boolean
  /** Why it can't be confirmed right now, shown in place of the button. */
  status_text: string | null
}

export interface ChatMessageView {
  id: string
  role: 'user' | 'assistant'
  text: string
  local_date: string
  created_at: string
  cards: CardView[]
}
