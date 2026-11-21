import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const signOut = vi.fn(async () => ({}))
const deleteUser = vi.fn()
let adminAvailable = true
let storedFiles: string[] = []
let listError: { message: string } | null = null
const removed: string[][] = []
const storage = {
  from: () => ({
    list: async (folder: string) => (listError
      ? { data: null, error: listError }
      : { data: storedFiles.filter((f) => f.startsWith(`${folder}/`)).slice(0, 100).map((f) => ({ id: f, name: f.split('/')[1] })), error: null }),
    remove: async (paths: string[]) => {
      removed.push(paths)
      storedFiles = storedFiles.filter((f) => !paths.includes(f))
      return { data: [], error: null }
    },
  }),
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser, signOut } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => (adminAvailable ? { auth: { admin: { deleteUser } }, storage } : null),
}))

import { POST } from '@/app/api/account/delete/route'

const post = (body: unknown) =>
  POST(new Request('http://x/api/account/delete', { method: 'POST', body: JSON.stringify(body) }))

describe('POST /api/account/delete', () => {
  beforeEach(() => {
    getUser.mockReset(); deleteUser.mockReset(); signOut.mockClear(); adminAvailable = true
    storedFiles = []; listError = null; removed.length = 0
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

  it('removes the caller\'s album files before deleting the account', async () => {
    storedFiles = [...Array.from({ length: 150 }, (_, i) => `u1/${i}.jpg`), 'u2/keep.jpg']
    const response = await post({ confirm_email: 'me@example.com' })
    expect(response.status).toBe(200)
    expect(storedFiles).toEqual(['u2/keep.jpg'])
    expect(removed.flat().every((path) => path.startsWith('u1/'))).toBe(true)
    expect(deleteUser).toHaveBeenCalledWith('u1')
  })

  it('treats a missing bucket as nothing to remove', async () => {
    listError = { message: 'Bucket not found' }
    expect((await post({ confirm_email: 'me@example.com' })).status).toBe(200)
    expect(deleteUser).toHaveBeenCalled()
  })

  it('keeps the account when the album files cannot be removed', async () => {
    listError = { message: 'storage down' }
    expect((await post({ confirm_email: 'me@example.com' })).status).toBe(500)
    expect(deleteUser).not.toHaveBeenCalled()
  })
})
