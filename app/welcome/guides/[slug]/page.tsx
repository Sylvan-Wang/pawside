import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import JsonLd from '@/components/site/JsonLd'
import { GUIDES, guideBySlug, guidePath, type GuideBlock } from '@/lib/site/guides'
import { OG_IMAGE, SITE_NAME, SITE_URL } from '@/lib/site/content'

export const dynamicParams = false

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const guide = guideBySlug(slug)
  if (!guide) return {}
  const title = `${guide.seoTitle}｜爪边 Pawside`
  const url = guidePath(guide)
  return {
    title: { absolute: title },
    description: guide.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article', locale: 'zh_CN', siteName: SITE_NAME, title, description: guide.description, url, images: [OG_IMAGE],
      publishedTime: guide.published, modifiedTime: guide.updated,
    },
    twitter: { card: 'summary_large_image', title, description: guide.description, images: [OG_IMAGE.url] },
  }
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case 'h2': return <h2 className="title guide__h2">{block.text}</h2>
    case 'p': return <p>{block.text}</p>
    case 'list': return <ul className="list">{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
    case 'note': return <p className="muted small guide__note">{block.text}</p>
    case 'table':
      return (
        <div className="guide__table">
          <table>
            <thead><tr>{block.head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
            <tbody>{block.rows.map((row) => <tr key={row.join('|')}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )
  }
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = guideBySlug(slug)
  if (!guide) notFound()
  const url = `${SITE_URL}${guidePath(guide)}`
  const others = GUIDES.filter((item) => item.slug !== guide.slug)
  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.description,
    datePublished: guide.published,
    dateModified: guide.updated,
    inLanguage: 'zh-CN',
    mainEntityOfPage: url,
    image: `${SITE_URL}${OG_IMAGE.url}`,
    author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  }
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '爪边', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: '训练指南', item: `${SITE_URL}/welcome/guides` },
      { '@type': 'ListItem', position: 3, name: guide.title, item: url },
    ],
  }
  return (
    <>
      <JsonLd data={article} />
      <JsonLd data={crumbs} />
      <article>
        <section className="page-hero">
          <div className="wrap">
            <p className="crumbs"><Link href="/">爪边</Link> / <Link href="/welcome/guides">训练指南</Link></p>
            <h1 className="display guide__title" style={{ marginTop: 16 }}>{guide.title}</h1>
            <p className="lede" style={{ maxWidth: 640 }}>{guide.lede}</p>
            <p className="muted small" style={{ marginTop: 12 }}>
              <time dateTime={guide.updated}>{guide.updated}</time> 更新 · 约 {guide.minutes} 分钟读完
            </p>
          </div>
        </section>
        <section className="sec">
          <div className="wrap guide">
            {guide.body.map((block, index) => <Block key={index} block={block} />)}
            <p style={{ marginTop: 32 }}><Link href="/auth" className="btn btn--ink">开始使用</Link></p>
          </div>
        </section>
      </article>
      {others.length > 0 && (
        <section className="sec sec--warm">
          <div className="wrap">
            <h2 className="title">接着看</h2>
            <ul className="guide-list">
              {others.map((item) => (
                <li key={item.slug}>
                  <Link href={guidePath(item)} className="card card--flat guide-card">
                    <h3 className="card__title">{item.title}</h3>
                    <p className="card__text">{item.description}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}
