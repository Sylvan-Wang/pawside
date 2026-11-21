import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanItem } from '../../lib/coach-chat/schemas'

/** 「识别这一餐」 with Storage, the database and the model replaced by fakes. */
type Row = Record<string, unknown>
let photos: Row[] = []
let drafts: Row[] = []
let messages: Row[] = []
let ownsConversation = true
let resolvedWith: PlanItem[] = []

vi.mock('../../lib/photos/store', () => ({
  getPhotosByIds: async (_s: unknown, userId: string, ids: string[]) => photos.filter((p) => p.user_id === userId && ids.includes(p.id as string)),
  photoDataUrl: async () => 'data:image/jpeg;base64,AAAA',
}))
vi.mock('../../lib/coach-chat/store', () => ({
  conversationBelongsTo: async () => ownsConversation,
  insertUserMessage: async (_s: unknown, input: { clientMessageId: string; text: string }) => {
    const existing = messages.find((m) => m.client_message_id === input.clientMessageId)
    if (existing) return { message: existing, duplicate: true }
    const message = { id: `m${messages.length}`, role: 'user', content: input.text, client_message_id: input.clientMessageId, cards: [], created_at: new Date().toISOString(), local_date: '2026-11-19' }
    messages.push(message)
    return { message, duplicate: false }
  },
  insertAssistantMessage: async (_s: unknown, input: { text: string; draftIds: string[]; replyToMessageId: string }) => {
    const message = { id: `m${messages.length}`, role: 'assistant', content: input.text, reply_to: input.replyToMessageId, cards: input.draftIds.map((draft_id) => ({ draft_id })), created_at: new Date().toISOString(), local_date: '2026-11-19' }
    messages.push(message)
    return message
  },
  findReplyTo: async (_s: unknown, _u: string, id: string) => messages.find((m) => m.reply_to === id) ?? null,
  attachDraftsToMessage: async () => {},
  insertDraft: async (_s: unknown, draft: Row) => {
    const row = { id: `d${drafts.length}`, status: 'proposed', version: 1, expires_at: '2099-01-01T00:00:00Z', ...draft }
    drafts.push(row)
    return row
  },
  getDrafts: async (_s: unknown, _u: string, ids: string[]) => drafts.filter((d) => ids.includes(d.id as string)),
}))
vi.mock('../../lib/coach-chat/meal', async (original) => ({
  ...(await original<typeof import('../../lib/coach-chat/meal')>()),
  resolveItems: async (_s: unknown, _u: string, items: PlanItem[]) => {
    resolvedWith = items
    return {
      items: items.map((item) => ({
        name_raw: item.name, name_resolved: null, amount_text: null, quantity: null, unit: null, food_id: null,
        resolution_source: 'unresolved', source_ref_id: null, per100g: null, weight_g: item.grams, weight_basis: item.gramsBasis,
        nutrition: null, nutrition_status: 'unknown', fixed_actuals: false, caveat: null,
      })),
      warnings: [],
    }
  },
}))

import { handlePhotoMeal, PhotoMealError } from '../../lib/coach-chat/photo-meal'
import { validPhotoMeal, cleanFoods } from '../../lib/coach-chat/photo-recognize'

const CONV = 'c1'
const recognizer = vi.fn()
const deps = () => ({ supabase: {} as never, userId: 'u1', recognizer, estimator: vi.fn() as never, now: () => new Date('2026-11-19T04:30:00Z') })
const input = (photoIds: string[], clientMessageId = crypto.randomUUID()) => ({ conversationId: CONV, clientMessageId, photoIds, timeZone: 'Asia/Shanghai' })

beforeEach(() => {
  photos = [
    { id: 'meal1', user_id: 'u1', category: 'meal', conversation_id: CONV, content_type: 'image/jpeg', storage_path: 'u1/a.jpg' },
    { id: 'body1', user_id: 'u1', category: 'body', conversation_id: CONV, content_type: 'image/jpeg', storage_path: 'u1/b.jpg' },
    { id: 'other-chat', user_id: 'u1', category: 'meal', conversation_id: 'c2', content_type: 'image/jpeg', storage_path: 'u1/c.jpg' },
    { id: 'theirs', user_id: 'u2', category: 'meal', conversation_id: CONV, content_type: 'image/jpeg', storage_path: 'u2/d.jpg' },
  ]
  drafts = []; messages = []; ownsConversation = true; resolvedWith = []
  recognizer.mockReset()
  recognizer.mockResolvedValue({ ok: true, model: 'm', latencyMs: 5, tokensIn: 1, tokensOut: 1, result: { is_meal: true, reason: '', note: '', foods: [{ name: '米饭', grams: 180, confidence: 'medium' }, { name: '番茄炒蛋', grams: null, confidence: 'high' }] } })
})

describe('handlePhotoMeal', () => {
  it('turns a meal photo into a card to confirm, with weights marked as photo estimates', async () => {
    const result = await handlePhotoMeal(deps(), input(['meal1']))
    expect(recognizer).toHaveBeenCalledWith(['data:image/jpeg;base64,AAAA'])
    expect(resolvedWith.map((i) => [i.name, i.grams, i.gramsBasis])).toEqual([['米饭', 180, 'model_estimate'], ['番茄炒蛋', null, 'unknown']])
    expect(drafts).toHaveLength(1)
    expect(drafts[0].kind).toBe('meal')
    const payload = drafts[0].payload as { meal_type: string; meal_type_source: string; warnings: string[]; date: string }
    expect(payload).toMatchObject({ meal_type: 'lunch', meal_type_source: 'inferred', date: '2026-11-19' })
    expect(payload.warnings).toContain('photo_estimate')
    expect(result.cards).toHaveLength(1)
    expect(result.assistantMessage.content).toMatch(/确认后才会保存/)
  })

  it.each([['body1'], ['other-chat'], ['theirs'], ['missing']])('refuses %s before anything is sent to the model', async (id) => {
    await expect(handlePhotoMeal(deps(), input([id]))).rejects.toBeInstanceOf(PhotoMealError)
    expect(recognizer).not.toHaveBeenCalled()
    expect(messages).toHaveLength(0)
  })

  it('refuses more than three photos', async () => {
    await expect(handlePhotoMeal(deps(), input(['a', 'b', 'c', 'd']))).rejects.toMatchObject({ code: 'bad_photos' })
  })

  it('says so honestly when the photo is not a meal, and makes no card', async () => {
    recognizer.mockResolvedValue({ ok: true, model: 'm', latencyMs: 5, tokensIn: 1, tokensOut: 1, result: { is_meal: false, reason: '照片太暗', note: '', foods: [] } })
    const result = await handlePhotoMeal(deps(), input(['meal1']))
    expect(drafts).toHaveLength(0)
    expect(result.assistantMessage.content).toContain('照片太暗')
  })

  it('apologises without a card when the model fails', async () => {
    recognizer.mockResolvedValue({ ok: false, reason: 'timeout', model: 'm', latencyMs: 30000 })
    const result = await handlePhotoMeal(deps(), input(['meal1']))
    expect(drafts).toHaveLength(0)
    expect(result.cards).toEqual([])
  })

  it('answers a retried tap with the first answer instead of calling the model again', async () => {
    const id = crypto.randomUUID()
    await handlePhotoMeal(deps(), input(['meal1'], id))
    const again = await handlePhotoMeal(deps(), input(['meal1'], id))
    expect(again.duplicate).toBe(true)
    expect(recognizer).toHaveBeenCalledTimes(1)
    expect(drafts).toHaveLength(1)
  })

  it('writes nothing when meal logging is switched off', async () => {
    await handlePhotoMeal({ ...deps(), mealsEnabled: false }, input(['meal1']))
    expect(recognizer).not.toHaveBeenCalled()
    expect(drafts).toHaveLength(0)
  })
})

describe('photo recognizer output checks', () => {
  it('accepts the schema shape and rejects calories or absurd weights', () => {
    expect(validPhotoMeal({ is_meal: true, reason: '', note: '', foods: [{ name: '米饭', grams: 150, confidence: 'high' }] })).toBe(true)
    expect(validPhotoMeal({ is_meal: true, reason: '', note: '', foods: [{ name: '米饭', grams: 99999, confidence: 'high' }] })).toBe(false)
    expect(validPhotoMeal({ is_meal: true, reason: '', note: '', foods: [{ name: '', grams: 100, confidence: 'high' }] })).toBe(false)
    expect(validPhotoMeal({ is_meal: true, reason: '', foods: [] })).toBe(false)
  })

  it('drops repeats from several angles', () => {
    expect(cleanFoods([{ name: '米饭', grams: 150, confidence: 'high' }, { name: ' 米饭 ', grams: 160, confidence: 'low' }]).map((f) => f.grams)).toEqual([150])
  })
})
