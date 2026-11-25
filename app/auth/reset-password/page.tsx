'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/use-locale'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const t = useT()
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
    if (password !== confirm) return setError(t('auth.errors.mismatch'))
    if (password.length < 6) return setError(t('auth.errors.tooShort'))
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      router.push('/home')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('auth.errors.resetFailed'))
    } finally {
      setLoading(false)
    }
  }

  if (!ready) return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <p className="text-sm text-gray-400">{t('auth.resetPage.verifying')}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center px-6">
      <h1 className="text-xl font-bold text-gray-900 mb-1">{t('auth.resetPage.title')}</h1>
      <p className="text-sm text-gray-400 mb-8">{t('auth.resetPage.subtitle')}</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">{t('auth.resetPage.newPassword')}</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder={t('auth.passwordPlaceholder')} required minLength={6} />
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">{t('auth.confirmPassword')}</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-gray-400"
            placeholder={t('auth.confirmPlaceholder')} required />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full bg-black text-white rounded-xl py-3.5 text-sm font-medium disabled:opacity-50">
          {loading ? t('auth.resetPage.submitting') : t('auth.resetPage.submit')}
        </button>
      </form>
    </div>
  )
}
