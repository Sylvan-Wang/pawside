import Link from 'next/link'

export default function ConfirmationFailedPage() {
  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6">
      <section className="w-full max-w-sm text-center">
        <p className="text-3xl mb-4">🐾</p>
        <h1 className="text-xl font-bold text-gray-900">邮箱确认失败</h1>
        <p className="mt-3 text-sm leading-6 text-gray-500">
          确认链接无效或已经过期。请返回登录；如果还没有完成注册，可以重新提交邮箱。
        </p>
        <Link
          href="/auth"
          className="mt-6 inline-flex rounded-xl bg-black px-6 py-3 text-sm font-medium text-white"
        >
          返回登录
        </Link>
      </section>
    </main>
  )
}
