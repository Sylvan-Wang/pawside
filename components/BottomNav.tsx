'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { MessageKey } from '@/lib/i18n'
import { useT } from '@/lib/i18n/use-locale'

const navItems: { href: string; labelKey: MessageKey; icon: string }[] = [
  { href: '/home', labelKey: 'common.nav.home', icon: '🏠' },
  { href: '/history', labelKey: 'common.nav.history', icon: '📋' },
  { href: '/weekly', labelKey: 'common.nav.weekly', icon: '📊' },
  { href: '/settings', labelKey: 'common.nav.settings', icon: '⚙️' },
]

export default function BottomNav() {
  const pathname = usePathname()
  const t = useT()
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white border-t border-gray-100 z-40">
      <div className="flex">
        {navItems.map(({ href, labelKey, icon }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors
              ${active ? 'text-black font-medium' : 'text-gray-400'}`}>
              <span className="text-xl mb-0.5">{icon}</span>
              {t(labelKey)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
