import type { SupabaseClient } from '@supabase/supabase-js'
import type { DraftKind, DraftPayload, DraftRow, DraftStatus } from './types'

/**
 * Persistence for the chat: conversations, messages, drafts. All access goes
 * through the signed-in user's client, so row-level security is the final
 * ownership check; the explicit user_id filters are belt and braces.
 */

export interface MessageRow {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  client_message_id: string | null
  reply_to_message_id: string | null
  content: string
  cards: Array<{ draft_id: string }>
  local_date: string
  created_at: string
}

const MESSAGE_COLUMNS = 'id,conversation_id,role,client_message_id,reply_to_message_id,content,cards,local_date,created_at'
const DRAFT_COLUMNS = 'id,user_id,conversation_id,message_id,kind,status,version,request_id,payload,target_record_id,target_updated_at,supersedes_id,clarifications_used,result,error_code,expires_at,created_at,updated_at'

/**
 * What may be logged about a failure: its kind and database code, never its message.
 * Database messages can quote the row that failed (a constraint violation prints the
 * whole row), and that row can hold what the user typed.
 */
export function describeError(error: unknown): string {
  if (error instanceof StoreError) return `StoreError code=${error.code ?? 'none'}`
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; code?: unknown }
    return `${typeof e.name === 'string' ? e.name : 'Error'} code=${typeof e.code === 'string' && e.code ? e.code : 'none'}`
  }
  return 'unknown'
}

export class StoreError extends Error {
  constructor(message: string, readonly code: string | null = null) {
    super(message)
  }
}

function fail(action: string, error: { message: string; code?: string }): never {
  throw new StoreError(`${action}: ${error.message}`, error.code ?? null)
}

/** The user's current conversation, creating the first one on demand. */
export async function getOrCreateConversation(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('coach_conversations')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) fail('load conversation', error)
  if (data) return data.id as string

  const created = await supabase
    .from('coach_conversations')
    .insert({ user_id: userId })
    .select('id')
    .single()
  if (created.error) fail('create conversation', created.error)
  return created.data.id as string
}

export async function conversationBelongsTo(supabase: SupabaseClient, userId: string, conversationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('coach_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) fail('check conversation', error)
  return Boolean(data)
}

/**
 * Stores the user's message once per client_message_id. A retry of the same
 * send finds the original instead of inserting a second copy.
 */
export async function insertUserMessage(
  supabase: SupabaseClient,
  input: { userId: string; conversationId: string; clientMessageId: string; text: string; localDate: string },
): Promise<{ message: MessageRow; duplicate: boolean }> {
  const inserted = await supabase
    .from('coach_messages')
    .insert({
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: 'user',
      client_message_id: input.clientMessageId,
      content: input.text,
      local_date: input.localDate,
    })
    .select(MESSAGE_COLUMNS)
    .single()

  if (!inserted.error) return { message: inserted.data as MessageRow, duplicate: false }
  if (inserted.error.code !== '23505') fail('save message', inserted.error)

  const existing = await supabase
    .from('coach_messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', input.userId)
    .eq('client_message_id', input.clientMessageId)
    .single()
  if (existing.error) fail('load duplicate message', existing.error)
  return { message: existing.data as MessageRow, duplicate: true }
}

export async function insertAssistantMessage(
  supabase: SupabaseClient,
  input: {
    userId: string
    conversationId: string
    replyToMessageId: string
    text: string
    draftIds: string[]
    localDate: string
  },
): Promise<MessageRow> {
  const { data, error } = await supabase
    .from('coach_messages')
    .insert({
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: 'assistant',
      reply_to_message_id: input.replyToMessageId,
      content: input.text,
      cards: input.draftIds.map((draft_id) => ({ draft_id })),
      local_date: input.localDate,
    })
    .select(MESSAGE_COLUMNS)
    .single()
  if (error) fail('save reply', error)
  await supabase
    .from('coach_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', input.conversationId)
    .eq('user_id', input.userId)
  return data as MessageRow
}

export async function findReplyTo(
  supabase: SupabaseClient,
  userId: string,
  userMessageId: string,
): Promise<MessageRow | null> {
  const { data, error } = await supabase
    .from('coach_messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', userId)
    .eq('reply_to_message_id', userMessageId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) fail('load reply', error)
  return (data as MessageRow | null) ?? null
}

/** Newest first when `before` is given as a cursor; callers reverse for display. */
export async function listMessages(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  options: { before?: string | null; limit?: number } = {},
): Promise<MessageRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100)
  let query = supabase
    .from('coach_messages')
    .select(MESSAGE_COLUMNS)
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (options.before) query = query.lt('created_at', options.before)
  const { data, error } = await query
  if (error) fail('load messages', error)
  return ((data ?? []) as MessageRow[]).reverse()
}

export async function countUserMessagesSince(supabase: SupabaseClient, userId: string, sinceIso: string): Promise<number> {
  const { count, error } = await supabase
    .from('coach_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'user')
    .gte('created_at', sinceIso)
  if (error) fail('count messages', error)
  return count ?? 0
}

export async function deleteConversation(supabase: SupabaseClient, userId: string, conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('coach_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId)
  if (error) fail('delete conversation', error)
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export interface NewDraft {
  userId: string
  conversationId: string
  messageId: string | null
  kind: DraftKind
  status?: DraftStatus
  payload: DraftPayload | Record<string, unknown>
  targetRecordId?: string | null
  targetUpdatedAt?: string | null
  supersedesId?: string | null
  version?: number
  clarificationsUsed?: number
}

export async function insertDraft(supabase: SupabaseClient, draft: NewDraft): Promise<DraftRow> {
  const { data, error } = await supabase
    .from('coach_drafts')
    .insert({
      user_id: draft.userId,
      conversation_id: draft.conversationId,
      message_id: draft.messageId,
      kind: draft.kind,
      status: draft.status ?? 'proposed',
      version: draft.version ?? 1,
      payload: draft.payload,
      target_record_id: draft.targetRecordId ?? null,
      target_updated_at: draft.targetUpdatedAt ?? null,
      supersedes_id: draft.supersedesId ?? null,
      clarifications_used: draft.clarificationsUsed ?? 0,
    })
    .select(DRAFT_COLUMNS)
    .single()
  if (error) fail('save draft', error)
  return data as DraftRow
}

export async function getDraft(supabase: SupabaseClient, userId: string, draftId: string): Promise<DraftRow | null> {
  const { data, error } = await supabase
    .from('coach_drafts')
    .select(DRAFT_COLUMNS)
    .eq('id', draftId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) fail('load draft', error)
  return (data as DraftRow | null) ?? null
}

export async function getDrafts(supabase: SupabaseClient, userId: string, draftIds: string[]): Promise<DraftRow[]> {
  if (draftIds.length === 0) return []
  const { data, error } = await supabase
    .from('coach_drafts')
    .select(DRAFT_COLUMNS)
    .eq('user_id', userId)
    .in('id', draftIds)
  if (error) fail('load drafts', error)
  return (data ?? []) as DraftRow[]
}

/** Drafts the user could still act on (newest first). */
export async function listOpenDrafts(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  now: Date,
): Promise<DraftRow[]> {
  const { data, error } = await supabase
    .from('coach_drafts')
    .select(DRAFT_COLUMNS)
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .in('status', ['needs_clarification', 'proposed'])
    .gt('expires_at', now.toISOString())
    .order('created_at', { ascending: false })
    .limit(6)
  if (error) fail('load open drafts', error)
  return (data ?? []) as DraftRow[]
}

/** The most recent meal this conversation saved (target of "刚才那顿"). */
export async function findLastSavedMealDraft(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  sinceIso: string,
): Promise<DraftRow | null> {
  const { data, error } = await supabase
    .from('coach_drafts')
    .select(DRAFT_COLUMNS)
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .in('kind', ['meal', 'meal_edit'])
    .eq('status', 'saved')
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) fail('load last saved meal', error)
  return (data as DraftRow | null) ?? null
}

/**
 * Moves a draft along an allowed edge, but only if it is still in one of the
 * `from` states (and at `version`, when given). Returns null when someone else
 * got there first - the caller treats that as "already handled", not an error.
 * The database trigger enforces the same edges; this is the optimistic lock.
 */
export async function transitionDraft(
  supabase: SupabaseClient,
  input: {
    userId: string
    draftId: string
    from: DraftStatus[]
    to: DraftStatus
    version?: number
    result?: Record<string, unknown> | null
    errorCode?: string | null
  },
): Promise<DraftRow | null> {
  let query = supabase
    .from('coach_drafts')
    .update({
      status: input.to,
      ...(input.result !== undefined ? { result: input.result } : {}),
      ...(input.errorCode !== undefined ? { error_code: input.errorCode } : {}),
    })
    .eq('id', input.draftId)
    .eq('user_id', input.userId)
    .in('status', input.from)
  if (input.version !== undefined) query = query.eq('version', input.version)
  const { data, error } = await query.select(DRAFT_COLUMNS)
  if (error) fail('update draft', error)
  const rows = (data ?? []) as DraftRow[]
  return rows[0] ?? null
}

export async function attachDraftsToMessage(
  supabase: SupabaseClient,
  userId: string,
  draftIds: string[],
  messageId: string,
): Promise<void> {
  if (draftIds.length === 0) return
  const { error } = await supabase
    .from('coach_drafts')
    .update({ message_id: messageId })
    .eq('user_id', userId)
    .in('id', draftIds)
  if (error) fail('link drafts', error)
}
