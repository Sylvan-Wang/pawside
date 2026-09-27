import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserted: Record<string, unknown>[] = []
let insertResult: { data: { id: string } | null; error: { code: string; message: string } | null } = {
  data: { id: 'gen-1' }, error: null,
}
let createClientImpl: () => unknown = () => ({
  from: () => ({
    insert: (row: Record<string, unknown>) => {
      inserted.push(row)
      return { select: () => ({ single: async () => insertResult }) }
    },
  }),
})

vi.mock('../../lib/supabase/server.ts', () => ({
  createClient: async () => createClientImpl(),
}))

const { logGeneration } = await import('../../lib/ai/generation-log.ts')

const base = {
  userId: 'user-1',
  surface: 'workout_session_feedback' as const,
  inputSnapshotId: 'snap-1',
  promptVersion: 'v1',
  model: 'test-model',
}

describe('logGeneration', () => {
  beforeEach(() => {
    inserted.length = 0
    insertResult = { data: { id: 'gen-1' }, error: null }
    createClientImpl = () => ({
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted.push(row)
          return { select: () => ({ single: async () => insertResult }) }
        },
      }),
    })
  })

  it('records a successful generation and returns the row id', async () => {
    const id = await logGeneration({ ...base, status: 'ok', payload: { a: 1 }, output: { summary: 'ok' } })
    expect(id).toBe('gen-1')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ status: 'ok', fail_reason: null, attempt: 1 })
  })

  it('records a failed generation with its reason', async () => {
    await logGeneration({
      ...base, status: 'failed', payload: {}, failReason: 'untraceable_number', failDetail: '99', attempt: 2,
    })
    expect(inserted[0]).toMatchObject({ status: 'failed', fail_reason: 'untraceable_number', fail_detail: '99', attempt: 2 })
  })

  it('never persists a fail_reason on a row marked ok (DB consistency constraint)', async () => {
    await logGeneration({ ...base, status: 'ok', payload: {}, failReason: 'untraceable_number' })
    expect(inserted[0].fail_reason).toBeNull()
  })

  it('truncates an overlong fail_detail rather than failing the insert', async () => {
    await logGeneration({ ...base, status: 'failed', payload: {}, failReason: 'timeout', failDetail: 'x'.repeat(5000) })
    expect((inserted[0].fail_detail as string).length).toBe(2000)
  })

  it('returns null, never throws, when the insert errors', async () => {
    insertResult = { data: null, error: { code: '42501', message: 'denied' } }
    await expect(logGeneration({ ...base, status: 'ok', payload: {} })).resolves.toBeNull()
  })

  it('returns null, never throws, when the client itself cannot be created', async () => {
    createClientImpl = () => { throw new Error('no cookies in this context') }
    await expect(logGeneration({ ...base, status: 'ok', payload: {} })).resolves.toBeNull()
  })
})
