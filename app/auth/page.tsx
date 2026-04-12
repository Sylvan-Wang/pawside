'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthPage() {
  const router = useRouter()
  const supabase = createClient()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registered, setRegistered] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'register') {
        if (password !== confirm) throw new Error('两次密码不一致')
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) throw new Error('该邮箱已注册，请直接登录')
        setRegistered(true)
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('onboarding_completed')
          .eq('id', data.user.id)
          .single()
        if (profile?.onboarding_completed) {
          router.push('/home')
        } else {
          router.push('/onboarding')
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '操作失败'
      if (msg.includes('Email not confirmed') || msg.includes('email_not_confirmed')) {
        setError('邮箱尚未验证，请检查收件箱并点击确认链接')
      } else if (msg.includes('Invalid login') || msg.includes('invalid_credentials')) {
        setError('邮箱或密码错误')
      } else if (msg.includes('already registered')) {
        setError('该邮箱已注册，请直接登录')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center px-6">
      {registered && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => router.push('/home')}>
          <div className="bg-gray-900 text-white px-8 py-5 rounded-2xl shadow-2xl text-center animate-fade-in">
            <p className="text-2xl mb-1">🍻</p>
            <p className="text-base font-medium">注册成功！</p>
            <p className="text-xs text-gray-400 mt-1">点击继续</p>
          </div>
        </div>
      )}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">爪边 Pawside</h1>
        <p className="text-gray-400 text-sm">健身记录，简单有效</p>
      </div>

      <div className="flex mb-6 border-b border-gray-100">
        <button
          onClick={() => { setMode('login'); setRegistered(false); setConfirm('') }}
          className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'login' ? 'text-black border-b-2 border-black' : 'text-gray-400'}`}
        >
          登录
        </button>
        <button
          onClick={() => { setMode('register'); setRegistered(false); setConfirm('') }}
          className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'register' ? 'text-black border-b-2 border-black' : 'text-gray-400'}`}
        >
          注册
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">邮箱</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder="your@email.com"
            required
          />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">密码</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder="至少 6 位"
            required
            minLength={6}
          />
        </div>
        {mode === 'register' && (
          <div>
            <label className="block text-sm text-gray-600 mb-1">确认密码</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
              placeholder="再输一次"
              required
            />
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50 mt-2"
        >
          {loading ? '加载中…' : mode === 'login' ? '登录' : '注册'}
        </button>

        {mode === 'login' && (
          <p className="text-center">
            <a href="/auth/forgot-password" className="text-xs text-gray-400 underline">忘记密码？</a>
          </p>
        )}
      </form>

      <p className="text-center text-sm text-gray-400 mt-6">
        {mode === 'login' ? '还没有账号？' : '已有账号？'}
        <button
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setRegistered(false); setConfirm('') }}
          className="text-black ml-1 font-medium"
        >
          {mode === 'login' ? '去注册' : '去登录'}
        </button>
      </p>
    </div>
  )
}
