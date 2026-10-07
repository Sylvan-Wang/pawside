import type { Metadata } from 'next'
import SiteFooter from '@/components/site/SiteFooter'
import SiteHeader from '@/components/site/SiteHeader'
import { SITE_NAME, SITE_URL } from '@/lib/site/content'
import './site.css'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'zh_CN',
    images: [{ url: '/og/welcome.png', width: 1200, height: 630, alt: '爪边 Pawside：今天练什么，打开就知道' }],
  },
  twitter: { card: 'summary_large_image', images: ['/og/welcome.png'] },
  robots: { index: true, follow: true },
}

export default function WelcomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-shell">
      <a className="skip" href="#main">跳到正文</a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  )
}
