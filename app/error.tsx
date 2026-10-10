'use client'

import { useEffect } from 'react'
import { Cat } from '@/components/Cat'

/**
 * Last-resort screen when a page throws. Says sorry instead of blaming the user,
 * and offers a way forward. Records already saved are not affected by a screen error.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-6 text-center">
      <Cat name="crying" width={140} />
      <h1 className="text-lg font-semibold text-gray-900">这一页没打开</h1>
      <p className="text-sm text-gray-500">不是你的问题，已经保存的记录不受影响。</p>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
        <button type="button" onClick={() => retry()} className="rounded-xl bg-black py-3 text-sm font-semibold text-white">
          再试一次
        </button>
        <a href="/home" className="rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700">
          回到首页
        </a>
      </div>
    </main>
  )
}
