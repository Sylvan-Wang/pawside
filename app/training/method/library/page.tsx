import PageHeader from '@/components/PageHeader'
import { loadMethodLibrary } from '@/lib/method-library'
import Link from 'next/link'

export default async function MethodLibraryPage() {
  const { items, importEnabled } = await loadMethodLibrary()
  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="方法库" back />
      <main className="space-y-4 px-4 py-5">
        <header className="rounded-2xl bg-black p-5 text-white">
          <p className="text-xs text-white/60">训练计划</p>
          <h1 className="mt-2 text-2xl font-semibold">选择适合你的方法</h1>
          <p className="mt-2 text-sm leading-6 text-white/70">查看不会改变当前训练。切换时会再次确认。</p>
        </header>

        <Link href="/training/method/adjustments" className="block rounded-2xl bg-white p-4">
          <p className="font-medium text-gray-900">我的调整</p>
          <p className="mt-1 text-sm text-gray-500">查看并撤销长期生效的动作调整。</p>
        </Link>

        {importEnabled && (
          <Link href="/training/method/import" className="block rounded-2xl border border-dashed border-gray-300 bg-white p-4">
            <p className="font-medium text-gray-900">从文章导入方法</p>
            <p className="mt-1 text-sm text-gray-500">粘贴训练文章，核对后创建为你的私有方法。</p>
          </Link>
        )}

        <section className="space-y-3">
          {items.map((item) => (
            <Link
              key={item.releaseId ?? 'legacy-v1.2'}
              href={item.releaseId ? `/training/method?release=${item.releaseId}` : '/training/method'}
              className="block rounded-2xl bg-white p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-400">{item.sourceType === 'official' ? '官方方法' : '我的方法'} · v{item.version}</p>
                  <h2 className="mt-1 font-semibold text-gray-900">{item.name}</h2>
                  {item.description && <p className="mt-2 text-sm leading-5 text-gray-500">{item.description}</p>}
                </div>
                {item.current && <span className="shrink-0 rounded-full bg-black px-2.5 py-1 text-[11px] text-white">当前</span>}
              </div>
            </Link>
          ))}
        </section>
      </main>
    </div>
  )
}
