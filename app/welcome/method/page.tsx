import type { Metadata } from 'next'
import Link from 'next/link'
import JsonLd from '@/components/site/JsonLd'
import Reveal from '@/components/site/Reveal'
import { RotationPath } from '@/components/site/illustrations'
import { SITE_URL, OG_IMAGE } from '@/lib/site/content'

const TITLE = '三分化和四分化怎么练｜爪边 Pawside'
const DESCRIPTION = '三分化是推、拉、腿三天一圈，四分化是胸、背、腿、肩四天一圈。每个训练日练什么、每一组有哪几种，用白话讲清楚。'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/welcome/method' },
  openGraph: { type: 'website', locale: 'zh_CN', siteName: '爪边 Pawside', title: TITLE, description: DESCRIPTION, url: '/welcome/method', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
}

const SET_TYPES = [
  { name: '热身组', text: '轻松完成，让身体先动起来。重量轻，次数多一点。' },
  { name: '正式组', text: '这个动作真正要做的几组。有目标次数，不用做到力竭。' },
  { name: '力竭组', text: '做到再也做不动为止。只有方法里写明的组才会这样要求。' },
  { name: '休息-暂停组', text: '做到接近力竭，停几秒，再多做几次。比如“10 + 5”，就是先做 10 次，歇一下，再做 5 次。' },
  { name: '递减组', text: '做完之后降低重量，接着再做一轮。' },
]

export default function MethodPage() {
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '爪边', item: `${SITE_URL}/welcome` },
      { '@type': 'ListItem', position: 2, name: '训练方法', item: `${SITE_URL}/welcome/method` },
    ],
  }
  return (
    <>
      <JsonLd data={crumbs} />
      <section className="page-hero">
        <div className="wrap">
          <p className="crumbs"><Link href="/welcome">爪边</Link> / 训练方法</p>
          <h1 className="display" style={{ marginTop: 16 }}>
            先选一种，<span className="hl">再往前走。</span>
          </h1>
          <p className="lede" style={{ maxWidth: 640 }}>
            爪边目前有两种训练方式：三分化和四分化。你选好一种，之后每个训练日练什么、每个动作做几组，都由它排好，再按你自己的节奏往前走。
          </p>
        </div>
      </section>

      <section className="sec" id="three" aria-labelledby="three-title">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">三天一圈</p>
            <h2 className="title" id="three-title">三分化：推、拉、腿</h2>
            <p className="lede">
              把全身的训练分成三块，轮着练。一块练完，身体有时间恢复，下一次才轮到它。
            </p>
            <div className="stack stack--3">
              <article className="card card--flat"><h3 className="card__title" style={{ fontSize: 24 }}>推</h3><p className="card__text">胸、肩、手臂后侧。凡是“往外推”的动作，比如卧推。</p></article>
              <article className="card card--flat"><h3 className="card__title" style={{ fontSize: 24 }}>拉</h3><p className="card__text">背、手臂前侧。凡是“往回拉”的动作，比如下拉、划船。</p></article>
              <article className="card card--flat"><h3 className="card__title" style={{ fontSize: 24 }}>腿</h3><p className="card__text">大腿、臀、小腿。腿日有些动作的重量还在摸索，应用会告诉你“在找合适的重量”。</p></article>
            </div>
            <RotationPath labels={['推', '拉', '腿']} />
          </Reveal>
        </div>
      </section>

      <section className="sec sec--warm" id="four" aria-labelledby="four-title">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">四天一圈</p>
            <h2 className="title" id="four-title">四分化：胸、背、腿、肩</h2>
            <p className="lede">
              把全身分成四天，每个部位练得更集中。另外有两个可选的日子：腹肌日和有氧日，它们不算在一圈里，想练就练。
            </p>
            <ul className="tags" aria-label="训练日">
              <li className="tag">胸 + 三头</li><li className="tag">背</li><li className="tag">腿</li><li className="tag">肩</li>
              <li className="tag tag--opt">腹肌 · 可选</li><li className="tag tag--opt">有氧 · 可选</li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="sec" aria-labelledby="sets-title">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">读得懂每一组</p>
            <h2 className="title" id="sets-title">一组，有哪几种？</h2>
            <p className="lede">训练页里，每一组旁边都会写着它是哪一种，以及目标是多少。</p>
            <div className="glossary">
              {SET_TYPES.map((item) => (
                <div key={item.name} className="gloss"><h3>{item.name}</h3><p>{item.text}</p></div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="sec sec--warm" aria-labelledby="rest-title">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">没练完怎么办</p>
            <h2 className="title" id="rest-title">按顺序，不按日历。</h2>
            <ul className="list" style={{ maxWidth: 640 }}>
              <li>下一次练什么，由你练没练完决定，不看今天星期几。</li>
              <li>周三没去，周五打开，下一次还是原来那一天。</li>
              <li>每个训练日可以按你今天的时间，选 30、45、60 或 90 分钟。</li>
            </ul>
            <p style={{ marginTop: 28 }}><Link href="/auth" className="btn btn--ink">开始使用</Link></p>
            <p className="muted small" style={{ marginTop: 20, maxWidth: 560 }}>
              训练方法基于公开的训练思路整理。内容仅供参考，不是医疗建议；有伤病或身体不适，请先问医生或专业教练。
            </p>
          </Reveal>
        </div>
      </section>
    </>
  )
}
