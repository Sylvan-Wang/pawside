'use client'

import Link from 'next/link'
import { useT } from '@/lib/i18n/use-locale'

export default function ConfirmationFailedPage() {
  const t = useT()
  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6">
      <section className="w-full max-w-sm text-center">
        <p className="text-3xl mb-4">🐾</p>
        <h1 className="text-xl font-bold text-gray-900">{t('auth.confirmFailed.title')}</h1>
        <p className="mt-3 text-sm leading-6 text-gray-500">
          {t('auth.confirmFailed.body')}
        </p>
        <Link
          href="/auth"
          className="mt-6 inline-flex rounded-xl bg-black px-6 py-3 text-sm font-medium text-white"
        >
          {t('auth.backToLogin')}
        </Link>
      </section>
    </main>
  )
}
