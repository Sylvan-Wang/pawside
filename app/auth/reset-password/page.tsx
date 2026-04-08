'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase handles the token from URL hash automatically via onAuthStateChange
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [supabase])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('两次密码不一致')
    if (password.length < 6) return setError('密码至少 6 位')
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      router.push('/home')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '重置失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  if (!ready) return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <p className="text-sm text-gray-400">验证链接中…</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center px-6">
      <h1 className="text-xl font-bold text-gray-900 mb-1">设置新密码</h1>
      <p className="text-sm text-gray-400 mb-8">请输入你的新密码</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">新密码</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder="至少 6 位" required minLength={6} />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">确认密码</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder="再输一次" required />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
          {loading ? '设置中…' : '确认修改'}
        </button>
      </form>
    </div>
  )
}
