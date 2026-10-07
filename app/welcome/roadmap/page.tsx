import type { Metadata } from 'next'
import Link from 'next/link'
import JsonLd from '@/components/site/JsonLd'
import Reveal from '@/components/site/Reveal'
import StatusBadge from '@/components/site/StatusBadge'
import { IconCamera, IconChat, IconRing } from '@/components/site/illustrations'
import { SITE_URL, OG_IMAGE } from '@/lib/site/content'
import { featureById, featuresByStatus } from '@/lib/site/features'

const TITLE = '路线图｜爪边 Pawside'
const DESCRIPTION = '爪边现在能做什么，接下来想做什么。'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/welcome/roadmap' },
  openGraph: { type: 'website', locale: 'zh_CN', siteName: '爪边 Pawside', title: TITLE, description: DESCRIPTION, url: '/welcome/roadmap', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
}

const CONCEPT: Record<string, { icon: React.ReactNode; note: string }> = {
  'food-photo': { icon: <IconCamera width={44} height={44} />, note: '概念示意：拍一张餐盘，认出里面有什么。还没有做出来。' },
  companion: { icon: <IconChat width={44} height={44} />, note: '概念示意：练的时候能说话、问下一步。还没有做出来，现在应用里没有对话功能。' },
  'more-devices': { icon: <IconRing width={44} height={44} />, note: '概念示意：把智能戒指、手表里的睡眠和活动放到同一个地方看。还没有做出来。' },
}

export default function RoadmapPage() {
  const live = featuresByStatus('live')
  const beta = featuresByStatus('beta')
  const planned = featuresByStatus('planned')
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '爪边', item: `${SITE_URL}/welcome` },
      { '@type': 'ListItem', position: 2, name: '路线图', item: `${SITE_URL}/welcome/roadmap` },
    ],
  }
  return (
    <>
      <JsonLd data={crumbs} />
      <section className="page-hero">
        <div className="wrap">
          <p className="crumbs"><Link href="/welcome">爪边</Link> / 路线图</p>
          <h1 className="display" style={{ marginTop: 16 }}>
            现在能做什么，<span className="hl">接下来想做什么。</span>
          </h1>
        </div>
      </section>

      <section className="sec" aria-labelledby="live">
        <div className="wrap">
          <Reveal>
            <h2 className="title" id="live">已上线</h2>
            <div className="glossary">
              {live.map((feature) => (
                <div key={feature.id} className="gloss"><h3>{feature.name}</h3><p>{feature.summary}</p></div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {beta.length > 0 && (
        <section className="sec sec--mist" aria-labelledby="beta">
          <div className="wrap">
            <h2 className="title" id="beta">内测中</h2>
            <div className="stack stack--3">
              {beta.map((feature) => (
                <article key={feature.id} className="card card--flat"><StatusBadge status="beta" /><h3 className="card__title" style={{ fontSize: 22 }}>{feature.name}</h3><p className="card__text">{feature.summary}</p></article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="sec sec--warm" aria-labelledby="planned">
        <div className="wrap">
          <Reveal>
            <h2 className="title" id="planned">规划中</h2>
            <div className="stack stack--3">
              {planned.map((feature) => {
                const concept = CONCEPT[feature.id]
                return (
                  <article key={feature.id} className="card card--flat">
                    <StatusBadge status={feature.status} />
                    <h3 className="card__title" style={{ fontSize: 24, paddingRight: 70 }}>{feature.name}</h3>
                    <p className="card__text">{feature.summary}</p>
                    {concept && (
                      <div className="concept">
                        {concept.icon}
                        <p>{concept.note}</p>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
            <p className="muted small" style={{ marginTop: 28, maxWidth: 560 }}>
              路线图会变，不构成承诺，也不含具体上线时间。{featureById('companion').name}等功能上线时，这一页会同步更新。
            </p>
          </Reveal>
        </div>
      </section>
    </>
  )
}
