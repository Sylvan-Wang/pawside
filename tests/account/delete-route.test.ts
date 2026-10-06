import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const signOut = vi.fn(async () => ({}))
const deleteUser = vi.fn()
let adminAvailable = true

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser, signOut } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => (adminAvailable ? { auth: { admin: { deleteUser } } } : null),
}))

import { POST } from '@/app/api/account/delete/route'

const post = (body: unknown) =>
  POST(new Request('http://x/api/account/delete', { method: 'POST', body: JSON.stringify(body) }))

describe('POST /api/account/delete', () => {
  beforeEach(() => {
    getUser.mockReset(); deleteUser.mockReset(); signOut.mockClear(); adminAvailable = true
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'Me@Example.com' } }, error: null })
    deleteUser.mockResolvedValue({ error: null })
  })

  it('rejects signed-out callers', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await post({ confirm_email: 'me@example.com' })).status).toBe(401)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('refuses without the matching email', async () => {
    expect((await post({ confirm_email: 'other@example.com' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('says so when the service key is not configured, and deletes nothing', async () => {
    adminAvailable = false
    expect((await post({ confirm_email: 'me@example.com' })).status).toBe(503)
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('deletes the caller only, case-insensitively, and signs out', async () => {
    const response = await post({ confirm_email: ' me@example.com ' })
    expect(response.status).toBe(200)
    expect(deleteUser).toHaveBeenCalledWith('u1')
    expect(signOut).toHaveBeenCalled()
  })

  it('reports failure when the deletion fails', async () => {
    deleteUser.mockResolvedValue({ error: { message: 'boom' } })
    expect((await post({ confirm_email: 'me@example.com' })).status).toBe(500)
    expect(signOut).not.toHaveBeenCalled()
  })
})
