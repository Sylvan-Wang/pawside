'use client'

import { useState } from 'react'
import { CONTACT_EMAIL } from '@/lib/site/content'

type Status = 'idle' | 'sending' | 'done' | 'error'

/** One step: an optional name and an email. No account, no confirmation email. */
export default function SeedForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'sending') return
    const form = new FormData(event.currentTarget)
    setStatus('sending')
    setMessage('')
    try {
      const response = await fetch('/api/seed-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? ''),
          email: String(form.get('email') ?? ''),
          website: String(form.get('website') ?? ''),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setStatus('error')
        setMessage(payload?.error?.message ?? '暂时无法提交')
        return
      }
      setStatus('done')
    } catch {
      setStatus('error')
      setMessage('网络好像断了，请稍后再试')
    }
  }

  if (status === 'done') {
    return (
      <div className="seed__done" role="status">
        <p className="seed__done-title">收到了。</p>
        <p>有新的内测安排和福利，我们会发邮件告诉你。这一步不会自动发确认邮件。</p>
      </div>
    )
  }

  return (
    <form className="seed__form" onSubmit={submit} noValidate={false}>
      <label className="seed__label" htmlFor="seed-name">怎么称呼你（选填）</label>
      <input id="seed-name" name="name" type="text" maxLength={40} autoComplete="name" className="seed__input" />
      <label className="seed__label" htmlFor="seed-email">邮箱</label>
      <input id="seed-email" name="email" type="email" required maxLength={254} autoComplete="email" inputMode="email" className="seed__input" placeholder="you@example.com" />
      {/* honeypot: people never see or fill this */}
      <div aria-hidden="true" className="seed__trap">
        <label>网站<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <button type="submit" className="btn btn--ink seed__btn" disabled={status === 'sending'}>
        {status === 'sending' ? '提交中…' : '加入种子用户'}
      </button>
      <p className="seed__fine">
        只用来联系内测和福利相关的事，不发广告。提交即表示你同意我们用这个邮箱联系你，详见<a href="/privacy">隐私政策</a>。
      </p>
      {status === 'error' && (
        <p className="seed__error" role="alert">
          {message}。也可以直接发邮件到 <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>。
        </p>
      )}
    </form>
  )
}
