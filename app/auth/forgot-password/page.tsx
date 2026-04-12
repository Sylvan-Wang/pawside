'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || window.location.origin
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${siteUrl}/auth/reset-password`,
      })
      if (error) throw error
      setSent(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '发送失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center px-6">
      <button onClick={() => router.back()} className="absolute top-4 left-4 text-gray-400 text-lg">←</button>

      <h1 className="text-xl font-bold text-gray-900 mb-1">找回密码</h1>
      <p className="text-sm text-gray-400 mb-8">输入注册邮箱，我们将发送重置链接</p>

      {sent ? (
        <div className="text-center">
          <p className="text-sm text-gray-700 mb-2">重置邮件已发送</p>
          <p className="text-xs text-gray-400 mb-6">请检查你的邮箱（包括垃圾邮件箱）</p>
          <button onClick={() => router.push('/auth')}
            className="text-sm text-black underline">返回登录</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">邮箱</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
              placeholder="your@email.com" required />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
            {loading ? '发送中…' : '发送重置邮件'}
          </button>
        </form>
      )}
    </div>
  )
}
