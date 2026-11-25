'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, setAuthPersistence } from '@/lib/supabase/client'
import { clearTrainingNavigationCache } from '@/lib/training-navigation-cache'
import { signupSourceMetadata } from '@/lib/site/attribution'
import { getAuthErrorMessage } from '@/lib/auth-errors'
import { useLocale, useT } from '@/lib/i18n/use-locale'
import LanguageSwitch from '@/components/LanguageSwitch'

export default function AuthPage() {
  const router = useRouter()
  const supabase = createClient()
  const [locale] = useLocale()
  const t = useT()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [confirmationMessage, setConfirmationMessage] = useState('')
  const [confirmationError, setConfirmationError] = useState('')
  const [registrationResult, setRegistrationResult] = useState<'signed-in' | 'confirmation-pending' | null>(null)

  useEffect(() => {
    clearTrainingNavigationCache()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'register') {
        if (password !== confirm) throw new Error(t('auth.errors.mismatch'))
        const emailRedirectTo = `${window.location.origin}/auth/callback?next=/onboarding`
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // Which channel brought this sign-up (lib/site/attribution.ts); empty if none.
          options: { emailRedirectTo, data: signupSourceMetadata() },
        })
        if (error) throw error
        setRegistrationResult(data.session ? 'signed-in' : 'confirmation-pending')
      } else {
        setAuthPersistence(rememberMe)
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setAuthPersistence(rememberMe)
        window.location.replace('/home')
        return
      }
    } catch (err: unknown) {
      setError(getAuthErrorMessage(err, locale))
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
      setConfirmationMessage(t('auth.resent'))
    } catch (err: unknown) {
      setConfirmationError(getAuthErrorMessage(err, locale))
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
              {registrationResult === 'signed-in' ? t('auth.signedInTitle') : t('auth.pendingTitle')}
            </p>
            <p className="text-xs text-gray-400 mt-2 leading-5">
              {registrationResult === 'signed-in'
                ? t('auth.signedInBody')
                : t('auth.pendingBody')}
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
                  {resending ? t('auth.sending') : t('auth.resend')}
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
              {registrationResult === 'signed-in' ? t('auth.continue') : t('auth.backToLogin')}
            </button>
          </div>
        </div>
      )}
      <div className="mb-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">{t('auth.brand')}</h1>
        <p className="text-gray-400 text-sm">{t('auth.tagline')}</p>
      </div>

      <div className="flex mb-6 border-b border-gray-100">
        <button
          onClick={() => { setMode('login'); setRegistrationResult(null); setConfirm('') }}
          className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'login' ? 'text-black border-b-2 border-black' : 'text-gray-400'}`}
        >
          {t('auth.tabLogin')}
        </button>
        <button
          onClick={() => { setMode('register'); setRegistrationResult(null); setConfirm('') }}
          className={`flex-1 pb-3 text-sm font-medium transition-colors ${mode === 'register' ? 'text-black border-b-2 border-black' : 'text-gray-400'}`}
        >
          {t('auth.tabRegister')}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">{t('auth.email')}</label>
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
          <label className="block text-sm text-gray-600 mb-1">{t('auth.password')}</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder={t('auth.passwordPlaceholder')}
            required
            minLength={6}
          />
        </div>
        {mode === 'register' && (
          <div>
            <label className="block text-sm text-gray-600 mb-1">{t('auth.confirmPassword')}</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
              placeholder={t('auth.confirmPlaceholder')}
              required
            />
          </div>
        )}

        {mode === 'login' && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={event => setRememberMe(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-black"
            />
            <span>{t('auth.rememberMe')}</span>
          </label>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50 mt-2"
        >
          {loading ? t('auth.loading') : mode === 'login' ? t('auth.tabLogin') : t('auth.tabRegister')}
        </button>

        {mode === 'login' && (
          <p className="text-center">
            <a href="/auth/forgot-password" className="text-xs text-gray-400 underline">{t('auth.forgot')}</a>
          </p>
        )}
      </form>

      <p className="mt-6 text-center text-xs leading-5 text-gray-400">
        {mode === 'register' ? t('auth.agreeRegister') : t('auth.agreeLogin')}
        <a href="/terms" className="underline">{t('auth.terms')}</a>{t('auth.and')}<a href="/privacy" className="underline">{t('auth.privacy')}</a>{t('auth.agreeEnd')}
      </p>

      <p className="text-center text-sm text-gray-400 mt-4">
        {mode === 'login' ? t('auth.noAccount') : t('auth.hasAccount')}
        <button
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setRegistrationResult(null); setConfirm('') }}
          className="text-black ml-1 font-medium"
        >
          {mode === 'login' ? t('auth.goRegister') : t('auth.goLogin')}
        </button>
      </p>

      {/* 英文开关关着时不渲染；开着时英文用户在登录前就能切语言 */}
      <LanguageSwitch compact />
    </div>
  )
}
