'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function getAuthErrorMessage(err: unknown) {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String(err.code)
    : ''
  const message = err instanceof Error ? err.message : '操作失败'

  if (code === 'email_address_not_authorized') {
    return '当前邮件服务无法向这个邮箱发送确认邮件，请联系管理员配置正式邮件服务'
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return '确认邮件发送过于频繁，请至少等待 60 秒后再试'
  }
  if (code === 'email_not_confirmed' || message.includes('Email not confirmed')) {
    return '邮箱尚未验证，请检查收件箱并点击确认链接'
  }
  if (code === 'invalid_credentials' || message.includes('Invalid login')) {
    return '邮箱或密码错误'
  }
  if (message.includes('already registered')) {
    return '该邮箱已注册，请直接登录'
  }
  return message
}

export default function AuthPage() {
  const router = useRouter()
  const supabase = createClient()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [confirmationMessage, setConfirmationMessage] = useState('')
  const [confirmationError, setConfirmationError] = useState('')
  const [registrationResult, setRegistrationResult] = useState<'signed-in' | 'confirmation-pending' | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'register') {
        if (password !== confirm) throw new Error('两次密码不一致')
        const emailRedirectTo = `${window.location.origin}/auth/callback?next=/onboarding`
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo },
        })
        if (error) throw error
        setRegistrationResult(data.session ? 'signed-in' : 'confirmation-pending')
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
      setError(getAuthErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleResendConfirmation() {
    setConfirmationError('')
    setConfirmationMessage('')
    setResending(true)
    try {
      const emailRedirectTo = `${window.location.origin}/auth/callback?next=/onboarding`
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo },
      })
      if (error) throw error
      setConfirmationMessage('确认邮件已重新发送，请检查收件箱和垃圾邮件文件夹。')
    } catch (err: unknown) {
      setConfirmationError(getAuthErrorMessage(err))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center px-6">
      {registrationResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-6">
          <div className="bg-gray-900 text-white px-8 py-6 rounded-2xl shadow-2xl text-center animate-fade-in max-w-sm">
            <p className="text-2xl mb-1">🍻</p>
            <p className="text-base font-medium">
              {registrationResult === 'signed-in' ? '注册成功！' : '请确认你的邮箱'}
            </p>
            <p className="text-xs text-gray-400 mt-2 leading-5">
              {registrationResult === 'signed-in'
                ? '账户已登录，可以继续完成基础资料。'
                : '如果该邮箱可以注册，确认邮件已经发送。请从邮件链接返回 Pawside。'}
            </p>
            {registrationResult === 'confirmation-pending' && (
              <>
                {confirmationMessage && (
                  <p className="mt-3 text-xs leading-5 text-emerald-300" aria-live="polite">
                    {confirmationMessage}
                  </p>
                )}
                {confirmationError && (
                  <p className="mt-3 text-xs leading-5 text-red-300" role="alert">
                    {confirmationError}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleResendConfirmation}
                  disabled={resending}
                  className="mt-4 w-full rounded-lg border border-white/25 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {resending ? '发送中…' : '重新发送确认邮件'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                if (registrationResult === 'signed-in') {
                  router.push('/onboarding')
                } else {
                  setMode('login')
                  setRegistrationResult(null)
                  setConfirm('')
                }
              }}
              className="mt-3 rounded-lg bg-white px-5 py-2 text-sm font-medium text-gray-900"
            >
              {registrationResult === 'signed-in' ? '继续' : '返回登录'}
            </button>
          </div>
        </div>
      )}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">爪边 Pawside</h1>
        <p className="text-gray-400 text-sm">健身记录，简单有效</p>
      </div>

      <div className="flex mb-6 border-b border-gray-100">
        <button
          onClick={() => { setMode('login'); setRegistrationResult(null); setConfirm('') }}
          className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'login' ? 'text-black border-b-2 border-black' : 'text-gray-400'}`}
        >
          登录
        </button>
        <button
          onClick={() => { setMode('register'); setRegistrationResult(null); setConfirm('') }}
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
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setRegistrationResult(null); setConfirm('') }}
          className="text-black ml-1 font-medium"
        >
          {mode === 'login' ? '去注册' : '去登录'}
        </button>
      </p>
    </div>
  )
}
