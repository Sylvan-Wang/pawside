import type { Metadata } from 'next'
import Link from 'next/link'
import JsonLd from '@/components/site/JsonLd'
import { GUIDES, guidePath } from '@/lib/site/guides'
import { OG_IMAGE, SITE_URL } from '@/lib/site/content'

const TITLE = '训练指南｜爪边 Pawside'
const DESCRIPTION = '给健身房新手的训练方法文章：三分化怎么练、每一组怎么做、错过一天怎么办，用白话讲清楚。'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/welcome/guides' },
  openGraph: { type: 'website', locale: 'zh_CN', siteName: '爪边 Pawside', title: TITLE, description: DESCRIPTION, url: '/welcome/guides', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
}

export default function GuidesPage() {
  const newestFirst = [...GUIDES].sort((a, b) => b.published.localeCompare(a.published))
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '爪边', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: '训练指南', item: `${SITE_URL}/welcome/guides` },
    ],
  }
  return (
    <>
      <JsonLd data={crumbs} />
      <section className="page-hero">
        <div className="wrap">
          <p className="crumbs"><Link href="/">爪边</Link> / 训练指南</p>
          <h1 className="display" style={{ marginTop: 16 }}>
            训练指南，<span className="hl">用白话讲。</span>
          </h1>
          <p className="lede" style={{ maxWidth: 640 }}>
            三分化怎么排、每一组怎么做、错过一天怎么办。看完就能进健身房照着练。
          </p>
        </div>
      </section>
      <section className="sec">
        <div className="wrap">
          <ul className="guide-list">
            {newestFirst.map((guide) => (
              <li key={guide.slug}>
                <Link href={guidePath(guide)} className="card card--flat guide-card">
                  <h2 className="card__title">{guide.title}</h2>
                  <p className="card__text">{guide.description}</p>
                  <p className="muted small">{guide.published} · 约 {guide.minutes} 分钟读完</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  )
}
