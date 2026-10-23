import Link from 'next/link'
import { CatNote } from '@/components/CatMascot'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-[480px] flex-col items-center justify-center px-6 text-center">
      <CatNote mood="confused" size={120} title="这一页找不到了" hint="链接可能写错了，或者这个页面已经不在了。" />
      <Link href="/home" className="mt-4 rounded-xl bg-black px-5 py-2.5 text-sm font-medium text-white">回到首页</Link>
    </main>
  )
}
