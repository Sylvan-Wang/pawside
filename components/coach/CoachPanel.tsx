'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import CatMascot from '@/components/CatMascot'
import { dateHeading, newClientId, replaceCard, withDateHeadings } from '@/lib/coach-chat/client'
import type { CardView, ChatMessageView } from '@/lib/coach-chat/types'
import { dayCacheKeys, formatLocalDateKey } from '@/lib/utils'
import ChatCard from './ChatCard'

type UiMessage = ChatMessageView & {
  /** Not yet answered by the server, or its send failed (kept so the same id can be re-sent). */
  local?: 'sending' | 'failed' | 'note'
  retry?: { clientMessageId: string; text: string; answer?: { draftId: string; optionIndex: number } }
}

const INTRO = '嗨，我是小爪。拍照、说一句，就能记饮食和运动；也可以问我吃什么。'
const QUICK_ACTIONS: Array<{ label: string; fill?: string; send?: string }> = [
  { label: '记一餐', fill: '我吃了' },
  { label: '记运动', fill: '我做了' },
  { label: '记体重', fill: '体重' },
  { label: '今天情况', send: '今天吃了什么，练了什么？' },
  { label: '吃什么', send: '今天吃什么好？' },
]

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || ''

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
    const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null
    if (response.ok && payload?.data !== undefined) return { ok: true, data: payload.data }
    return { ok: false, status: response.status, message: payload?.error?.message ?? '出了点问题，请稍后再试' }
  } catch {
    return { ok: false, status: 0, message: '网络好像断了' }
  }
}

/** Keeps the panel exactly above the on-screen keyboard (iOS/Android shrink the visual viewport, not the layout one). */
function useVisualViewport(active: boolean) {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null)
  useEffect(() => {
    if (!active) return
    const viewport = window.visualViewport
    if (!viewport) return
    const update = () => setBox({ height: viewport.height, top: viewport.offsetTop })
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [active])
  return box
}

export default function CoachPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [busyCards, setBusyCards] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const saved = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const viewport = useVisualViewport(true)
  const today = formatLocalDateKey(new Date())

  // Lock the page behind the panel while it is open.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  // Pages behind the panel fetch their own numbers when they open. After something was saved here
  // they would keep showing the old day, so closing the panel reloads the page once.
  const close = useCallback(() => {
    if (saved.current) window.location.reload()
    else onClose()
  }, [onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const load = useCallback(async () => {
    setState('loading')
    const conversation = await api<{ conversation_id: string }>('/api/coach/conversations', { method: 'POST' })
    if (!conversation.ok) { setNotice(conversation.message); setState('error'); return }
    const history = await api<{ messages: ChatMessageView[]; has_more: boolean }>(
      `/api/coach/conversations/${conversation.data.conversation_id}/messages?time_zone=${encodeURIComponent(timeZone())}`,
    )
    if (!history.ok) { setNotice(history.message); setState('error'); return }
    setConversationId(conversation.data.conversation_id)
    setMessages(history.data.messages)
    setHasMore(history.data.has_more)
    setNotice(null)
    setState('ready')
  }, [])

  useEffect(() => {
    // Loading on open is the point of this effect; the state it sets is the result of that fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => { if (state === 'ready') inputRef.current?.focus() }, [state])

  // Stay at the newest message.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, viewport?.height])

  async function loadOlder() {
    if (!conversationId || messages.length === 0) return
    const first = messages.find((m) => !m.local)
    if (!first) return
    const older = await api<{ messages: ChatMessageView[]; has_more: boolean }>(
      `/api/coach/conversations/${conversationId}/messages?before=${encodeURIComponent(first.created_at)}&time_zone=${encodeURIComponent(timeZone())}`,
    )
    if (!older.ok) { setNotice(older.message); return }
    setMessages((current) => [...older.data.messages, ...current])
    setHasMore(older.data.has_more)
  }

  async function deliver(clientMessageId: string, body: string, answer?: { draftId: string; optionIndex: number }) {
    if (!conversationId) return
    setSending(true)
    setNotice(null)
    const result = await api<{ user_message: ChatMessageView; assistant_message: ChatMessageView; updated_cards?: CardView[] }>('/api/coach/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: conversationId,
        client_message_id: clientMessageId,
        text: body,
        time_zone: timeZone(),
        ...(answer ? { answer: { draft_id: answer.draftId, option_index: answer.optionIndex } } : {}),
      }),
    })
    setSending(false)
    const localId = `local-${clientMessageId}`
    if (result.ok) {
      setMessages((current) => {
        // Older cards this turn replaced or cancelled are refreshed in place.
        const refreshed = (result.data.updated_cards ?? []).reduce((list, card) => replaceCard(list, card) as UiMessage[], current)
        return [
          ...refreshed.filter((m) => m.id !== localId),
          result.data.user_message,
          result.data.assistant_message,
        ]
      })
      return
    }
    // The message stays in the list with a retry that re-sends the SAME id, so a retry never doubles it.
    setMessages((current) => current.map((m) => (m.id === localId ? { ...m, local: 'failed' } : m)))
    setNotice(result.status === 0 ? '网络好像断了，点消息旁的「重试」再发一次。' : result.message)
  }

  function send(body: string, answer?: { draftId: string; optionIndex: number }) {
    const trimmed = body.trim()
    if (!trimmed || sending || !conversationId) return
    const clientMessageId = newClientId()
    const local: UiMessage = {
      id: `local-${clientMessageId}`,
      role: 'user',
      text: trimmed,
      local_date: today,
      created_at: new Date().toISOString(),
      cards: [],
      local: 'sending',
      retry: { clientMessageId, text: trimmed, answer },
    }
    setMessages((current) => [...current, local])
    setText('')
    void deliver(clientMessageId, trimmed, answer)
  }

  function retry(message: UiMessage) {
    if (!message.retry || sending) return
    setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, local: 'sending' } : m)))
    void deliver(message.retry.clientMessageId, message.retry.text, message.retry.answer)
  }

  async function act(card: CardView, kind: 'confirm' | 'cancel') {
    setBusyCards((current) => new Set(current).add(card.draft_id))
    setNotice(null)
    const result = await api<{ status: string; text: string; card: CardView; affected_dates?: string[] }>(`/api/coach/actions/${card.draft_id}/${kind}`, {
      method: 'POST',
      body: JSON.stringify(kind === 'confirm' ? { version: card.version, time_zone: timeZone() } : { time_zone: timeZone() }),
    })
    setBusyCards((current) => {
      const next = new Set(current)
      next.delete(card.draft_id)
      return next
    })
    if (!result.ok) {
      setNotice(result.status === 0 ? '网络好像断了，没保存上。请再点一次。' : result.message)
      return
    }
    if (result.data.status === 'saved') {
      saved.current = true
      try {
        for (const date of result.data.affected_dates ?? []) {
          for (const key of dayCacheKeys(date)) sessionStorage.removeItem(key)
        }
      } catch { /* storage unavailable */ }
    }
    setMessages((current) => {
      const updated = replaceCard(current, result.data.card)
      const note: UiMessage = {
        id: `note-${card.draft_id}-${Date.now()}`, role: 'assistant', text: result.data.text, local_date: today,
        created_at: new Date().toISOString(), cards: [], local: 'note',
      }
      return [...updated, note]
    })
  }

  function answer(card: CardView, optionIndex: number) {
    const label = card.question?.options[optionIndex]
    if (label) send(label, { draftId: card.draft_id, optionIndex })
  }

  async function clearConversation() {
    if (!conversationId) return
    if (!window.confirm('清空这段对话？已经保存的饮食、运动和体重记录不会被删除。')) return
    const result = await api<{ deleted: boolean }>(`/api/coach/conversations/${conversationId}`, { method: 'DELETE' })
    if (!result.ok) { setNotice(result.message); return }
    await load()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send(text)
    }
  }

  function quick(action: (typeof QUICK_ACTIONS)[number]) {
    if (action.send) { send(action.send); return }
    setText(action.fill ?? '')
    inputRef.current?.focus()
  }

  const rows = withDateHeadings(messages)
  const panelStyle = viewport ? { height: viewport.height, top: viewport.top } : { top: 0, bottom: 0 }

  return (
    <div
      className="fixed left-1/2 z-50 flex w-full max-w-[480px] -translate-x-1/2 flex-col bg-gray-50"
      style={panelStyle}
      role="dialog"
      aria-modal="true"
      aria-label="小爪"
    >
      <header className="flex items-center gap-2 border-b border-gray-100 bg-white px-3 py-2">
        <CatMascot mood="peek" size={32} />
        <p className="flex-1 text-sm font-semibold text-gray-900">小爪</p>
        <button type="button" onClick={clearConversation} className="px-2 py-1 text-xs text-gray-400" aria-label="清空对话">清空</button>
        <button type="button" onClick={close} className="px-2 py-1 text-xl leading-none text-gray-500" aria-label="关闭">×</button>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3" aria-live="polite">
        {state === 'loading' && <p className="flex items-center justify-center gap-1.5 py-8 text-sm text-gray-400"><CatMascot mood="thinking" size={28} />加载中…</p>}
        {state === 'error' && (
          <div className="py-8 text-center">
            <CatMascot mood="cry" size={64} />
            <p className="mt-1 text-sm text-gray-500">{notice ?? '暂时打不开对话'}</p>
            <button type="button" onClick={() => void load()} className="mt-3 rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-700">重试</button>
          </div>
        )}
        {state === 'ready' && (
          <>
            {hasMore && (
              <button type="button" onClick={() => void loadOlder()} className="mx-auto mb-3 block text-xs text-gray-400">看更早的消息</button>
            )}
            {messages.length === 0 && (
              <div className="py-6 text-center">
                <div className="mx-auto w-fit"><CatMascot mood="wave" size={72} /></div>
                <p className="mx-auto mt-2 max-w-[18rem] text-sm text-gray-600">{INTRO}</p>
              </div>
            )}
            {rows.map((row) => {
              if (row.type === 'date') {
                return <p key={`d-${row.date}`} className="my-3 text-center text-[11px] text-gray-400">{dateHeading(row.date, today)}</p>
              }
              const message = row.message as UiMessage
              const mine = message.role === 'user'
              return (
                <div key={message.id} className={`mb-3 flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] ${mine ? 'items-end' : 'items-start'}`}>
                    <div className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                      mine ? 'bg-black text-white' : message.local === 'note' ? 'bg-transparent px-1 text-xs text-gray-400' : 'bg-white text-gray-800'
                    } ${message.local === 'sending' ? 'opacity-60' : ''}`}>
                      {message.text}
                    </div>
                    {message.local === 'failed' && (
                      <button type="button" onClick={() => retry(message)} className="mt-1 text-xs text-red-500">没发出去 · 重试</button>
                    )}
                    {message.cards.map((card) => (
                      <ChatCard
                        key={card.draft_id}
                        card={card}
                        busy={busyCards.has(card.draft_id)}
                        onConfirm={(c) => void act(c, 'confirm')}
                        onCancel={(c) => void act(c, 'cancel')}
                        onAnswer={answer}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
            {sending && (
              <p className="mb-3 flex items-center gap-1.5 text-xs text-gray-400"><CatMascot mood="thinking" size={28} />小爪在看…</p>
            )}
          </>
        )}
      </div>

      {notice && state === 'ready' && <p className="bg-red-50 px-3 py-1.5 text-xs text-red-600" role="status">{notice}</p>}

      <footer className="border-t border-gray-100 bg-white px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mb-2 flex gap-2 overflow-x-auto" aria-label="快捷操作">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={state !== 'ready' || sending}
              onClick={() => quick(action)}
              className="shrink-0 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 active:bg-gray-50 disabled:opacity-40"
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="说说吃了什么、练了什么…"
            aria-label="消息"
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400"
          />
          <button
            type="button"
            onClick={() => send(text)}
            disabled={state !== 'ready' || sending || !text.trim()}
            className="h-10 shrink-0 rounded-2xl bg-black px-4 text-sm font-medium text-white disabled:opacity-40"
          >
            发送
          </button>
        </div>
      </footer>
    </div>
  )
}
