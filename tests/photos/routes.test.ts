import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Route tests against a small in-memory Supabase fake: it applies the eq/lt/gt
 * filters and keeps Storage objects in a map, so the tests can see what the
 * routes actually stored and removed.
 */
type Row = Record<string, unknown>
let signedIn = true
let chatOn = true
let tables: Record<string, Row[]> = {}
let objects: Map<string, Uint8Array>
let uploadFails = false

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let action: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Row | null = null
  let head = false
  let descending = false
  let limit = Infinity
  const rows = () => (tables[table] ??= [])
  const run = () => {
    if (action === 'insert') {
      const row: Row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), note: null, conversation_id: null, ...payload }
      if (row.client_request_id && rows().some((r) => r.user_id === row.user_id && r.client_request_id === row.client_request_id)) {
        return { data: null, error: { code: '23505', message: 'duplicate' } }
      }
      rows().push(row)
      return { data: [row], error: null }
    }
    let matched = rows().filter((row) => filters.every((f) => f(row)))
    if (action === 'update') { matched.forEach((row) => Object.assign(row, payload)); return { data: matched, error: null } }
    if (action === 'delete') { tables[table] = rows().filter((row) => !matched.includes(row)); return { data: matched, error: null } }
    matched = [...matched].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) * (descending ? -1 : 1)).slice(0, limit)
    return head ? { data: null, count: matched.length, error: null } : { data: matched, error: null }
  }
  const builder = {
    select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return builder },
    insert: (row: Row) => { action = 'insert'; payload = row; return builder },
    update: (patch: Row) => { action = 'update'; payload = patch; return builder },
    delete: () => { action = 'delete'; return builder },
    eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder },
    lt: (column: string, value: string) => { filters.push((row) => String(row[column]) < value); return builder },
    gt: (column: string, value: string) => { filters.push((row) => String(row[column]) > value); return builder },
    order: (_column: string, options: { ascending: boolean }) => { descending = !options.ascending; return builder },
    limit: (n: number) => { limit = n; return builder },
    maybeSingle: async () => { const result = run(); return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error } },
    single: async () => { const result = run(); return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error } },
    then: (resolve: (value: unknown) => void) => resolve(run()),
  }
  return builder
}

const storage = {
  from: () => ({
    upload: async (path: string, bytes: Uint8Array) => {
      if (uploadFails) return { data: null, error: { message: 'bucket missing' } }
      objects.set(path, bytes); return { data: { path }, error: null }
    },
    remove: async (paths: string[]) => { paths.forEach((path) => objects.delete(path)); return { data: [], error: null } },
    createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })), error: null }),
  }),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'u1' } : null }, error: null }) },
    rpc: async () => ({ data: chatOn, error: null }),
    from: (table: string) => query(table),
    storage,
  }),
}))

import { DELETE, PATCH } from '@/app/api/photos/[id]/route'
import { GET, POST } from '@/app/api/photos/route'

const BASE = 'https://paw-side.com/api/photos'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const CONVERSATION = '6f9619ff-8b86-4011-b42d-00cf4fc964ff'

function upload(fields: Record<string, string>, bytes: Uint8Array = JPEG) {
  const form = new FormData()
  form.set('file', new Blob([bytes as BlobPart]), 'x.jpg')
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return POST(new NextRequest(BASE, { method: 'POST', body: form }))
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  signedIn = true; chatOn = true; uploadFails = false
  objects = new Map()
  tables = { coach_conversations: [{ id: CONVERSATION, user_id: 'u1' }], user_photos: [] }
})

describe('POST /api/photos', () => {
  it('needs a signed-in user', async () => {
    signedIn = false
    expect((await upload({ category: 'meal', source: 'album', local_date: '2026-11-19' })).status).toBe(401)
    expect(objects.size).toBe(0)
  })

  it('stores the file in the user folder and files it in the album', async () => {
    const response = await upload({ category: 'body', source: 'album', local_date: '2026-11-19' })
    expect(response.status).toBe(201)
    const { data } = await response.json()
    expect(data.photo).toMatchObject({ category: 'body', source: 'album', content_type: 'image/jpeg' })
    expect(data.photo.url).toMatch(/^https:\/\/signed\/u1\/.+\.jpg$/)
    expect(data.photo).not.toHaveProperty('storage_path')
    expect([...objects.keys()][0]).toMatch(/^u1\//)
  })

  it('refuses a file that is not an image, whatever it is called', async () => {
    const response = await upload({ category: 'meal', source: 'album', local_date: '2026-11-19' }, new TextEncoder().encode('<script>'))
    expect(response.status).toBe(400)
    expect(objects.size).toBe(0)
  })

  it('stores a retried upload once', async () => {
    const fields = { category: 'meal', source: 'album', local_date: '2026-11-19', client_request_id: '0b5c3a52-1c1f-4c7c-9e3c-2a1f5a7f9c11' }
    const first = await (await upload(fields)).json()
    const second = await (await upload(fields)).json()
    expect(second.data.photo.id).toBe(first.data.photo.id)
    expect(objects.size).toBe(1)
    expect(tables.user_photos).toHaveLength(1)
  })

  it('accepts chat photos only when 小爪 is on and the conversation is the user\'s', async () => {
    const fields = { category: 'meal', source: 'chat', local_date: '2026-11-19', conversation_id: CONVERSATION }
    expect((await upload(fields)).status).toBe(201)
    expect((await upload({ ...fields, conversation_id: '11111111-1111-4111-8111-111111111111' })).status).toBe(404)
    chatOn = false
    expect((await upload(fields)).status).toBe(403)
  })

  it('reports a storage failure honestly and records nothing', async () => {
    uploadFails = true
    expect((await upload({ category: 'meal', source: 'album', local_date: '2026-11-19' })).status).toBe(500)
    expect(tables.user_photos).toHaveLength(0)
  })

  it('can be switched off', async () => {
    vi.stubEnv('PAWSIDE_PHOTOS', '0')
    expect((await upload({ category: 'meal', source: 'album', local_date: '2026-11-19' })).status).toBe(403)
    vi.unstubAllEnvs()
  })
})

describe('GET /api/photos', () => {
  it('lists only the user\'s photos in a category, with counts', async () => {
    tables.user_photos = [
      { id: 'a', user_id: 'u1', category: 'meal', source: 'album', storage_path: 'u1/a.jpg', created_at: '2026-11-18T00:00:00Z' },
      { id: 'b', user_id: 'u1', category: 'body', source: 'album', storage_path: 'u1/b.jpg', created_at: '2026-11-19T00:00:00Z' },
      { id: 'c', user_id: 'u2', category: 'meal', source: 'album', storage_path: 'u2/c.jpg', created_at: '2026-11-19T00:00:00Z' },
    ]
    const { data } = await (await GET(new NextRequest(`${BASE}?category=meal`))).json()
    expect(data.photos.map((photo: { id: string }) => photo.id)).toEqual(['a'])
    expect(data.counts).toEqual({ body: 1, meal: 1, poster: 0, other: 0 })
  })

  it('rejects an unknown category', async () => {
    expect((await GET(new NextRequest(`${BASE}?category=selfie`))).status).toBe(400)
  })
})

describe('PATCH / DELETE /api/photos/[id]', () => {
  const id = '22222222-2222-4222-8222-222222222222'
  beforeEach(() => {
    objects.set('u1/x.jpg', JPEG)
    tables.user_photos = [{ id, user_id: 'u1', category: 'meal', source: 'chat', storage_path: 'u1/x.jpg', created_at: '2026-11-19T00:00:00Z' }]
  })
  const patch = (body: unknown, target = id) =>
    PATCH(new Request(`${BASE}/${target}`, { method: 'PATCH', body: JSON.stringify(body) }), params(target))

  it('moves a photo to another album', async () => {
    expect((await patch({ category: 'body' })).status).toBe(200)
    expect(tables.user_photos[0].category).toBe('body')
  })

  it('keeps 报告海报 for report images only', async () => {
    expect((await patch({ category: 'poster' })).status).toBe(400)
    tables.user_photos[0].source = 'report'
    tables.user_photos[0].category = 'poster'
    expect((await patch({ category: 'meal' })).status).toBe(400)
  })

  it('deletes the file and the entry, and cannot touch someone else\'s photo', async () => {
    tables.user_photos[0].user_id = 'u2'
    expect((await DELETE(new Request(`${BASE}/${id}`), params(id))).status).toBe(404)
    expect(objects.has('u1/x.jpg')).toBe(true)
    tables.user_photos[0].user_id = 'u1'
    expect((await DELETE(new Request(`${BASE}/${id}`), params(id))).status).toBe(200)
    expect(objects.has('u1/x.jpg')).toBe(false)
    expect(tables.user_photos).toHaveLength(0)
  })
})
