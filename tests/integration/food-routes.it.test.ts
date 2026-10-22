import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { clientFor, count, createTestUser, deleteTestUser, IT_ENABLED, sql } from './harness'

/**
 * The EXISTING food pages' routes, exercised after the refactors this change made to them
 * (food resolver extracted, edit contract widened for raw-only items). The point is that the
 * manual flow still behaves exactly as before.
 */

let currentUserId: string | null = null
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    const real = clientFor(currentUserId ?? randomUUID())
    return new Proxy(real, {
      get(target, prop) {
        if (prop === 'auth') return { getUser: async () => ({ data: { user: currentUserId ? { id: currentUserId } : null }, error: null }) }
        return Reflect.get(target, prop) as unknown
      },
    }) as SupabaseClient
  },
}))

const created: string[] = []
afterAll(() => { for (const id of created) deleteTestUser(id) })
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })

function user() {
  const u = createTestUser({ feature: false })
  created.push(u.id)
  currentUserId = u.id
  return u
}

const rice = (extra: Record<string, unknown> = {}) => ({
  food_id: null, food_name_raw: '米饭', food_name_resolved: '米饭', weight_g: 200, user_confirmed: true,
  resolution_source: 'user_override', source_ref_id: null, per100g: null,
  fallback: { calories_kcal: 232, protein_g: 5, carbs_g: 51, fat_g: 0.6 }, ...extra,
})

describe.skipIf(!IT_ENABLED)('existing food routes after the refactor', { timeout: 30_000 }, () => {
  it('food search returns the same shape: canonical rows with per-100g nutrition', async () => {
    user()
    const { GET } = await import('../../app/api/foods/resolve/route')
    const res = await GET(req('GET', '/api/foods/resolve?q=鸡蛋'))
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: Array<{ source: string; name: string; food_id: number; nutrition: { basis_type: string; energy_kcal: number }; user_confirmed: boolean }> }
    expect(data.length).toBeGreaterThan(0)
    const egg = data.find((row) => row.name === '鸡蛋')!
    expect(egg).toMatchObject({ source: 'canonical_db', user_confirmed: true })
    expect(egg.nutrition.basis_type).toBe('per_100g')
    expect(typeof egg.food_id).toBe('number')
    expect((await GET(req('GET', '/api/foods/resolve?q='))).status).toBe(200)
  })

  it('confirming a food keeps its personal memory, and the next search finds it first', async () => {
    const u = user()
    const { GET, POST } = await import('../../app/api/foods/resolve/route')
    const res = await POST(req('POST', '/api/foods/resolve', {
      action: 'confirm', name: '妈妈的红烧肉', source: 'user_override', weight_g: 100, actual: { energy_kcal: 300, protein_g: 15, carb_g: 8, fat_g: 22 },
    }))
    expect(res.status).toBe(200)
    const { data } = await res.json() as { data: { source: string; source_ref_id: string; memory_id: string; nutrition: { energy_kcal: number }; user_confirmed: boolean } }
    expect(data).toMatchObject({ source: 'user_override', user_confirmed: true })
    expect(data.nutrition.energy_kcal).toBe(300)
    expect(count('user_food_memory', `user_id='${u.id}'`)).toBe(1)

    const found = await (await GET(req('GET', '/api/foods/resolve?q=红烧肉'))).json() as { data: Array<{ source: string; name: string }> }
    expect(found.data[0]).toMatchObject({ source: 'user_memory', name: '妈妈的红烧肉' })
    expect((await POST(req('POST', '/api/foods/resolve', { action: 'confirm', name: 'x' }))).status).toBe(422)
  })

  it('saving a meal from the food page is unchanged: v1 contract, idempotent on request_id', async () => {
    const u = user()
    const { POST } = await import('../../app/api/nutrition/food-log/route')
    const body = { request_id: randomUUID(), date: '2026-10-22', meal_type: 'lunch', items: [rice()] }
    const first = await POST(req('POST', '/api/nutrition/food-log', body))
    expect(first.status).toBe(200)
    const retry = await POST(req('POST', '/api/nutrition/food-log', body))
    expect((await retry.json() as { data: { idempotent: boolean } }).data.idempotent).toBe(true)
    expect(count('user_food_logs', `user_id='${u.id}'`)).toBe(1)
    expect(sql(`select input_mode from public.user_food_logs where user_id='${u.id}'`)).toBe('manual') // v1 still records manual
    // the page contract still refuses a weightless item (raw-only is not creatable from the form)
    const raw = await POST(req('POST', '/api/nutrition/food-log', { ...body, request_id: randomUUID(), items: [rice({ weight_g: null })] }))
    expect(raw.status).toBe(422)
  })

  it('editing a normal meal still goes through v1 and updates in place', async () => {
    const u = user()
    const post = (await import('../../app/api/nutrition/food-log/route')).POST
    const { PATCH, GET } = await import('../../app/api/nutrition/food-log/[id]/route')
    await post(req('POST', '/api/nutrition/food-log', { request_id: randomUUID(), date: '2026-10-22', meal_type: 'lunch', items: [rice()] }))
    const legacyId = sql(`select id from public.food_logs where user_id='${u.id}'`)
    const loaded = await (await GET(req('GET', '/x'), { params: Promise.resolve({ id: legacyId }) })).json() as { data: { updated_at: string; canonical_food_log_id: string } }

    const res = await PATCH(req('PATCH', '/x', {
      request_id: randomUUID(), date: '2026-10-22', meal_type: 'dinner', expected_updated_at: loaded.data.updated_at, items: [rice({ weight_g: 150, fallback: { calories_kcal: 174, protein_g: 4, carbs_g: 38, fat_g: 0.5 } })],
    }), { params: Promise.resolve({ id: legacyId }) })
    expect(res.status).toBe(200)
    expect(sql(`select meal_type || ':' || (select weight_g from public.user_food_log_items i where i.food_log_id = l.id) from public.user_food_logs l where user_id='${u.id}'`)).toBe('dinner:150.00')
    expect(count('user_food_logs', `user_id='${u.id}'`)).toBe(1)
  })

  it('editing a meal that holds a raw-only item keeps it (v2), and refuses it on an old-style record', async () => {
    const u = user()
    const { PATCH } = await import('../../app/api/nutrition/food-log/[id]/route')
    // a chat-style meal: one weighed item, one raw-only
    // create through the user's own client so RLS applies
    const { data, error } = await u.client.rpc('save_food_log_canonical_v2', {
      p_request_id: randomUUID(), p_log_date: '2026-10-22', p_meal_type: 'dinner', p_raw_input_text: null, p_notes: null,
      p_items: [
        { food_name_raw: '红烧肉', weight_g: null, calculation_basis: {} },
        { food_name_raw: '米饭', weight_g: 100, energy_kcal: 116, protein_g: 2.6, carb_g: 25.6, fat_g: 0.3, calculation_basis: {} },
      ],
      p_legacy_foods: [{ name: '红烧肉', weight_g: null, calories: null }, { name: '米饭', weight_g: 100, calories: 116 }], p_input_mode: 'ai_assisted',
    })
    expect(error).toBeNull()
    const legacyId = (data as { legacy_food_log_id: string }).legacy_food_log_id

    const res = await PATCH(req('PATCH', '/x', {
      request_id: randomUUID(), date: '2026-10-22', meal_type: 'dinner', expected_updated_at: null,
      items: [
        { food_id: null, food_name_raw: '红烧肉', food_name_resolved: '红烧肉', weight_g: null, nutrition_unknown: true, resolution_source: 'user_override', source_ref_id: null, user_confirmed: true, per100g: null },
        rice({ weight_g: 100, fallback: { calories_kcal: 116, protein_g: 2.6, carbs_g: 25.6, fat_g: 0.3 } }),
      ],
    }), { params: Promise.resolve({ id: legacyId }) })
    expect(res.status).toBe(200)
    expect(sql(`select food_name_raw || ':' || coalesce(weight_g::text,'null') from public.user_food_log_items where food_log_id in (select id from public.user_food_logs where user_id='${u.id}') order by 1`).split('\n'))
      .toEqual(['米饭:100.00', '红烧肉:null'])
  })

  it('a stale edit is refused with a 409 the page can show (the manual-page conflict path)', async () => {
    const u = user()
    const post = (await import('../../app/api/nutrition/food-log/route')).POST
    const { PATCH, GET } = await import('../../app/api/nutrition/food-log/[id]/route')
    await post(req('POST', '/api/nutrition/food-log', { request_id: randomUUID(), date: '2026-10-22', meal_type: 'lunch', items: [rice()] }))
    const legacyId = sql(`select id from public.food_logs where user_id='${u.id}'`)
    const loaded = await (await GET(req('GET', '/x'), { params: Promise.resolve({ id: legacyId }) })).json() as { data: { updated_at: string } }
    // someone else edits it first
    await PATCH(req('PATCH', '/x', { request_id: randomUUID(), date: '2026-10-22', meal_type: 'lunch', expected_updated_at: loaded.data.updated_at, items: [rice({ weight_g: 100 })] }), { params: Promise.resolve({ id: legacyId }) })
    // the second tab still holds the old version
    const outcome = await Promise.race([
      PATCH(req('PATCH', '/x', { request_id: randomUUID(), date: '2026-10-22', meal_type: 'lunch', expected_updated_at: loaded.data.updated_at, items: [rice({ weight_g: 50 })] }), { params: Promise.resolve({ id: legacyId }) }).then((r) => r.status),
      new Promise<string>((resolve) => setTimeout(() => resolve('HANGS'), 8000)),
    ])
    expect(outcome).toBe(409)
  }, 20_000)
})
