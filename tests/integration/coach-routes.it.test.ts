import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RawPlan } from '../../lib/coach-chat/schemas'
import { rawItem, rawPlan, rawTask, scriptedPlanner } from '../coach-chat/helpers'
import { clientFor, count, createTestUser, deleteTestUser, IT_ENABLED, sql } from './harness'

// The routes are exercised as the app would call them: only the signed-in user lookup and the model are stand-ins.
let currentUserId: string | null = null
let scripted: ReturnType<typeof scriptedPlanner> | null = null

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const real = clientFor(currentUserId ?? randomUUID())
    return new Proxy(real, {
      get(target, prop) {
        if (prop === 'auth') {
          return { getUser: async () => ({ data: { user: currentUserId ? { id: currentUserId } : null }, error: null }) }
        }
        return Reflect.get(target, prop) as unknown
      },
    }) as SupabaseClient
  },
}))
vi.mock('@/lib/coach-chat/planner', () => ({
  createPlanner: () => (system: string, input: string) => scripted!.planner(system, input),
  createEstimator: () => async () => ({ ok: true, byName: new Map() }),
}))

const TZ = 'Asia/Shanghai'
const json = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const created: string[] = []
afterAll(() => { for (const id of created) deleteTestUser(id) })
afterEach(() => { vi.unstubAllEnvs() })
beforeEach(() => { scripted = null })

function plan(...plans: RawPlan[]) { scripted = scriptedPlanner(plans) }
const lunch = rawPlan([rawTask('log_meal', {
  meal_type: 'lunch',
  items: [rawItem('米饭', { amount_value: 200, amount_unit: '克', estimate_basis: 'user_stated' })],
})])

describe.skipIf(!IT_ENABLED)('coach API routes', { timeout: 30_000 }, () => {
  async function granted() {
    const user = createTestUser()
    created.push(user.id)
    currentUserId = user.id
    const { POST } = await import('../../app/api/coach/conversations/route')
    const conversationId = ((await (await POST()).json()) as { data: { conversation_id: string } }).data.conversation_id
    return { user, conversationId }
  }

  it('is closed to signed-out callers and to users who were not granted the assistant', async () => {
    const { POST } = await import('../../app/api/coach/chat/route')
    const { GET } = await import('../../app/api/coach/status/route')
    const body = { conversation_id: randomUUID(), client_message_id: randomUUID(), text: 'hi', time_zone: TZ }

    currentUserId = null
    expect((await POST(json('/api/coach/chat', body))).status).toBe(401)
    expect(await (await GET()).json()).toEqual({ data: { enabled: false } })

    const stranger = createTestUser({ feature: false })
    created.push(stranger.id)
    currentUserId = stranger.id
    const denied = await POST(json('/api/coach/chat', body))
    expect(denied.status).toBe(403)
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe('FEATURE_DISABLED')
    expect(await (await GET()).json()).toEqual({ data: { enabled: false } })
    expect(count('coach_messages', `user_id='${stranger.id}'`)).toBe(0)
  })

  it('status reflects the grant and the kill switch', async () => {
    const { GET } = await import('../../app/api/coach/status/route')
    await granted()
    expect(await (await GET()).json()).toEqual({ data: { enabled: true } })
    vi.stubEnv('PAWSIDE_COACH_CHAT', '0')
    expect(await (await GET()).json()).toEqual({ data: { enabled: false } })
    const { POST } = await import('../../app/api/coach/chat/route')
    const off = await POST(json('/api/coach/chat', { conversation_id: randomUUID(), client_message_id: randomUUID(), text: 'hi', time_zone: TZ }))
    expect(off.status).toBe(403)
  })

  it('chat -> card -> confirm -> history: the whole path over HTTP handlers', async () => {
    const { conversationId, user } = await granted()
    const chat = (await import('../../app/api/coach/chat/route')).POST
    const confirm = (await import('../../app/api/coach/actions/[id]/confirm/route')).POST
    const messages = (await import('../../app/api/coach/conversations/[id]/messages/route')).GET

    plan(lunch)
    const turn = await chat(json('/api/coach/chat', { conversation_id: conversationId, client_message_id: randomUUID(), text: '午饭200克米饭', time_zone: TZ }))
    expect(turn.status).toBe(200)
    const { data } = await turn.json() as { data: { assistant_message: { text: string; cards: Array<{ draft_id: string; version: number; status: string; can_confirm: boolean }> } } }
    const card = data.assistant_message.cards[0]
    expect(card).toMatchObject({ status: 'proposed', can_confirm: true })
    expect(count('user_food_logs', `user_id='${user.id}'`)).toBe(0)

    const stale = await confirm(json('/x', { version: 9, time_zone: TZ }), { params: Promise.resolve({ id: card.draft_id }) })
    expect(((await stale.json()) as { data: { status: string } }).data.status).toBe('stale')
    expect(count('user_food_logs', `user_id='${user.id}'`)).toBe(0)

    const ok = await confirm(json('/x', { version: card.version, time_zone: TZ }), { params: Promise.resolve({ id: card.draft_id }) })
    const saved = (await ok.json()) as { data: { status: string; text: string; card: { status: string; status_text: string } } }
    expect(saved.data.status).toBe('saved')
    expect(saved.data.card).toMatchObject({ status: 'saved', status_text: '已保存' })
    expect(saved.data.text).toContain('午餐已记下')

    const again = await confirm(json('/x', { version: card.version, time_zone: TZ }), { params: Promise.resolve({ id: card.draft_id }) })
    expect(((await again.json()) as { data: { status: string } }).data.status).toBe('already_saved')
    expect(count('user_food_logs', `user_id='${user.id}'`)).toBe(1)

    // reopening the app later: history shows the same card, now saved
    const history = await messages(
      new NextRequest(`http://localhost/api/coach/conversations/${conversationId}/messages?time_zone=${TZ}`),
      { params: Promise.resolve({ id: conversationId }) },
    )
    const list = (await history.json()) as { data: { messages: Array<{ role: string; text: string; cards: Array<{ status: string }> }> } }
    expect(list.data.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(list.data.messages[1].cards[0].status).toBe('saved')
  })

  it('validates input and refuses a time zone it cannot use (no silent UTC)', async () => {
    const { conversationId } = await granted()
    const chat = (await import('../../app/api/coach/chat/route')).POST
    plan(rawPlan([]))
    const good = { conversation_id: conversationId, client_message_id: randomUUID(), text: '你好', time_zone: TZ }
    expect((await chat(json('/c', { ...good, time_zone: 'Mars/Olympus' }))).status).toBe(422)
    expect((await chat(json('/c', { ...good, text: '' }))).status).toBe(422)
    expect((await chat(json('/c', { ...good, client_message_id: 'nope' }))).status).toBe(422)
    expect((await chat(new NextRequest('http://localhost/c', { method: 'POST', body: '{not json' }))).status).toBe(400)
    expect((await chat(json('/c', { ...good, conversation_id: randomUUID() }))).status).toBe(404)
  })

  it("one user cannot confirm, cancel or read another user's card or history", async () => {
    const a = await granted()
    const chat = (await import('../../app/api/coach/chat/route')).POST
    plan(lunch)
    const turn = await chat(json('/c', { conversation_id: a.conversationId, client_message_id: randomUUID(), text: '午饭', time_zone: TZ }))
    const draftId = ((await turn.json()) as { data: { assistant_message: { cards: Array<{ draft_id: string }> } } }).data.assistant_message.cards[0].draft_id

    const b = createTestUser()
    created.push(b.id)
    currentUserId = b.id
    const confirm = (await import('../../app/api/coach/actions/[id]/confirm/route')).POST
    const cancel = (await import('../../app/api/coach/actions/[id]/cancel/route')).POST
    const messages = (await import('../../app/api/coach/conversations/[id]/messages/route')).GET
    expect((await confirm(json('/x', { version: 1, time_zone: TZ }), { params: Promise.resolve({ id: draftId }) })).status).toBe(404)
    expect((await cancel(json('/x', { time_zone: TZ }), { params: Promise.resolve({ id: draftId }) })).status).toBe(404)
    expect((await messages(new NextRequest(`http://localhost/m?time_zone=${TZ}`), { params: Promise.resolve({ id: a.conversationId }) })).status).toBe(404)
    expect(count('user_food_logs', `user_id='${a.user.id}'`)).toBe(0)
    expect(sql(`select status from public.coach_drafts where id='${draftId}'`)).toBe('proposed')
  })

  it('clearing the chat removes messages and cards but keeps the records saved from it', async () => {
    const { conversationId, user } = await granted()
    const chat = (await import('../../app/api/coach/chat/route')).POST
    const confirm = (await import('../../app/api/coach/actions/[id]/confirm/route')).POST
    const clear = (await import('../../app/api/coach/conversations/[id]/route')).DELETE
    plan(lunch)
    const turn = await chat(json('/c', { conversation_id: conversationId, client_message_id: randomUUID(), text: '午饭', time_zone: TZ }))
    const card = ((await turn.json()) as { data: { assistant_message: { cards: Array<{ draft_id: string; version: number }> } } }).data.assistant_message.cards[0]
    await confirm(json('/x', { version: card.version, time_zone: TZ }), { params: Promise.resolve({ id: card.draft_id }) })

    const res = await clear(new Request('http://localhost/x', { method: 'DELETE' }), { params: Promise.resolve({ id: conversationId }) })
    expect(res.status).toBe(200)
    expect(count('coach_messages', `user_id='${user.id}'`)).toBe(0)
    expect(count('coach_drafts', `user_id='${user.id}'`)).toBe(0)
    expect(count('user_food_logs', `user_id='${user.id}'`)).toBe(1)
  })

  it('a part switched off answers politely and writes nothing', async () => {
    const { conversationId, user } = await granted()
    const chat = (await import('../../app/api/coach/chat/route')).POST
    vi.stubEnv('PAWSIDE_COACH_CHAT_WEIGHT', '0')
    plan(rawPlan([rawTask('log_weight', { weight_value: 70, weight_unit: 'kg' })]))
    const turn = await chat(json('/c', { conversation_id: conversationId, client_message_id: randomUUID(), text: '体重70', time_zone: TZ }))
    const body = (await turn.json()) as { data: { assistant_message: { text: string; cards: unknown[] } } }
    expect(body.data.assistant_message.text).toContain('暂时关闭')
    expect(body.data.assistant_message.cards).toEqual([])
    expect(count('coach_drafts', `user_id='${user.id}'`)).toBe(0)
  })

  it('the daily message cap answers 429 instead of calling the model', async () => {
    const { conversationId, user } = await granted()
    sql(`insert into public.coach_messages (conversation_id, user_id, role, content, local_date)
         select '${conversationId}', '${user.id}', 'user', 'x', date '2026-10-22' from generate_series(1, 300)`)
    const chat = (await import('../../app/api/coach/chat/route')).POST
    plan(rawPlan([]))
    const res = await chat(json('/c', { conversation_id: conversationId, client_message_id: randomUUID(), text: '你好', time_zone: TZ }))
    expect(res.status).toBe(429)
    expect(scripted!.calls).toHaveLength(0)
  })
})
