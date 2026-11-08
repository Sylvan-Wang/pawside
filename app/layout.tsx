import type { Metadata, Viewport } from 'next'
import './globals.css'
import CoachHost from '@/components/coach/CoachHost'

export const metadata: Metadata = {
  title: '爪边 Pawside',
  description: '爪边 Pawside：打开就知道今天练什么，训练和饮食顺手记下来，晚上看看今天怎么样。',
  // Search engine ownership checks (public codes, not secrets).
  verification: { other: { 'baidu-site-verification': 'codeva-3FUP0ENXZ6' } },
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '爪边',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#111111',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://cdn.jsdelivr.net" />
      </head>
      <body suppressHydrationWarning>
        {children}
        <CoachHost />
      </body>
    </html>
  )
}
