'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/home', label: '首页', icon: '🏠' },
  { href: '/history', label: '历史', icon: '📋' },
  { href: '/weekly', label: '周报', icon: '📊' },
  { href: '/settings', label: '设置', icon: '⚙️' },
]

export default function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white border-t border-gray-100 z-40">
      <div className="flex">
        {navItems.map(({ href, label, icon }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors
              ${active ? 'text-black font-medium' : 'text-gray-400'}`}>
              <span className="text-xl mb-0.5">{icon}</span>
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
