import type { Metadata } from 'next'
import Link from 'next/link'
import JsonLd from '@/components/site/JsonLd'
import SeedForm from '@/components/site/SeedForm'
import PhoneDemo, { type DemoStep } from '@/components/site/PhoneDemo'
import Reveal from '@/components/site/Reveal'
import StatusBadge from '@/components/site/StatusBadge'
import {
  CowCatPeek,
  CowCatWithDumbbell,
  IconCamera,
  IconBowl,
  IconChat,
  IconClock,
  IconDumbbell,
  IconMoon,
  IconRing,
  PawTrail,
  RotationPath,
} from '@/components/site/illustrations'
import {
  ScreenDaily,
  ScreenMeal,
  ScreenPlan,
  ScreenReturn,
  ScreenSet,
} from '@/components/site/screens'
import { CONTACT_EMAIL, FAQ, SITE_NAME, SITE_URL, OG_IMAGE } from '@/lib/site/content'
import { featureById } from '@/lib/site/features'

const TITLE = '爪边 Pawside｜今天练什么，打开就知道'
const DESCRIPTION =
  '选好训练方法，之后从上次停下的地方继续。今天练哪一组、做哪些动作，打开就有；训练和饮食顺手记下来，晚上看看今天怎么样。'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/welcome' },
  openGraph: { type: 'website', locale: 'zh_CN', siteName: '爪边 Pawside', title: TITLE, description: DESCRIPTION, url: '/welcome', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
}

const STEPS: DemoStep[] = [
  { id: 'open', num: '01', title: '打开，看到今天练什么', desc: '不用重新找计划，也不用回忆上次练到哪。' },
  { id: 'time', num: '02', title: '选今天有多少时间', desc: '30、45、60 或 90 分钟，今天要做的动作数量跟着调整。' },
  { id: 'do', num: '03', title: '跟着做完这一轮', desc: '动作、组数、次数和提示都在当前训练里，做完一组点一下。' },
  { id: 'eat', num: '04', title: '吃过什么，顺手记下来', desc: '按食物和份量算出当天摄入，对照当天的参考范围看。' },
  { id: 'night', num: '05', title: '晚上，看今天留下了什么', desc: '训练、饮食和身体记录汇到一起，给出今天最值得注意的几件事和下一步。' },
]

const DECISIONS = [
  { when: '开练之前', ask: '今天练什么？', icon: <IconDumbbell /> },
  { when: '开始之前', ask: '这次练多久？', icon: <IconClock /> },
  { when: '每次回来', ask: '上次练到哪了？', icon: <IconMoon /> },
  { when: '吃饭的时候', ask: '今天吃得够不够？', icon: <IconBowl /> },
]

const seedCredits = featureById('seed-credits')

const PLANNED = [
  { feature: featureById('food-photo'), icon: <IconCamera /> },
  { feature: featureById('companion'), icon: <IconChat /> },
  { feature: featureById('more-devices'), icon: <IconRing /> },
]

export default function WelcomePage() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#org`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/icon.svg`,
        email: CONTACT_EMAIL,
      },
      { '@type': 'WebSite', '@id': `${SITE_URL}/#site`, url: SITE_URL, name: SITE_NAME, inLanguage: 'zh-CN', publisher: { '@id': `${SITE_URL}/#org` } },
      {
        '@type': 'SoftwareApplication',
        name: SITE_NAME,
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web（可添加到手机主屏幕）',
        description: DESCRIPTION,
        url: `${SITE_URL}/welcome`,
        inLanguage: 'zh-CN',
        publisher: { '@id': `${SITE_URL}/#org` },
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  }

  return (
    <>
      <JsonLd data={graph} />

      {/* hero */}
      <section className="hero">
        <div className="wrap hero__grid">
          <div>
            <span className="pill">内测阶段 · 可以直接注册</span>
            <h1 className="display">
              今天练什么？
              <br />
              <span className="hl">打开就知道。</span>
            </h1>
            <p className="lede">
              <strong>选好训练方法，之后从上次停下的地方继续。</strong>
              今天练哪一组、做哪些动作，打开就有。训练和饮食顺手记下来，晚上再看看今天怎么样、下一步该注意什么。
            </p>
            <div className="hero__cta">
              <Link href="/auth" className="btn btn--ink">开始使用</Link>
              <a href="#demo" className="btn btn--ghost">看看怎么用</a>
            </div>
            <p className="hero__note">手机上打开就能用，也可以添加到主屏幕。</p>
          </div>
          <CowCatWithDumbbell className="hero__art" />
        </div>
        <PawTrail className="hero__trail" />
      </section>

      {/* the decisions you make before every session */}
      <section className="sec sec--warm" aria-labelledby="moments">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">每次训练前</p>
            <h2 className="title" id="moments">每次练之前，都有一堆临场决定。</h2>
            <div className="thoughts">
              {DECISIONS.map((item) => (
                <div key={item.ask} className="thought">
                  <span className="thought__icon">{item.icon}</span>
                  <p className="thought__where">{item.when}</p>
                  <p className="thought__say">{item.ask}</p>
                </div>
              ))}
            </div>
            <p className="thoughts__answer">少一点临场决定，多一点直接开始。</p>
          </Reveal>
        </div>
      </section>

      {/* demo */}
      <section className="sec" id="demo" aria-labelledby="demo-title">
        <div className="wrap">
          <h2 className="title" id="demo-title">一次训练，从打开爪边开始。</h2>
          <p className="lede">点任意一步，手机里就会切到对应的界面。</p>
          <PhoneDemo
            steps={STEPS}
            screens={[<ScreenReturn key="open" />, <ScreenPlan key="time" />, <ScreenSet key="do" />, <ScreenMeal key="eat" />, <ScreenDaily key="night" />]}
          />
        </div>
      </section>

      {/* rest is not failure */}
      <section className="sec sec--ink band on-ink" aria-labelledby="rest">
        <div className="wrap">
          <Reveal>
            <h2 className="band__big" id="rest">
              没练，也不会<span className="hl">掉队。</span>
            </h2>
            <p className="band__sub">
              爪边按训练轮次往前走，不按日历催你。今天没练，下一次就从这里继续。
            </p>
            <RotationPath labels={['推', '拉', '腿']} />
          </Reveal>
        </div>
      </section>

      {/* methods */}
      <section className="sec sec--warm" aria-labelledby="methods">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">训练方式</p>
            <h2 className="title" id="methods">先选一种训练方式，之后按自己的节奏往前走。</h2>
            <p className="lede">不用每天重新决定练什么。</p>
            <div className="cards2">
              <article className="card">
                <h3 className="card__title">三分化</h3>
                <p className="card__sub">三天轮一圈</p>
                <p className="card__text">
                  推 / 拉 / 腿轮流进行：推日练胸、肩和手臂后侧，拉日练背和手臂前侧，腿日练腿。结构简单，训练频率灵活。
                </p>
                <ul className="tags" aria-label="训练日"><li className="tag">推</li><li className="tag">拉</li><li className="tag">腿</li></ul>
              </article>
              <article className="card">
                <h3 className="card__title">四分化</h3>
                <p className="card__sub">四天轮一圈</p>
                <p className="card__text">
                  胸 / 背 / 腿 / 肩拆得更开，每个训练日更集中。另有腹肌日和有氧日两个可选的日子，不算在一圈里。
                </p>
                <ul className="tags" aria-label="训练日">
                  <li className="tag">胸</li><li className="tag">背</li><li className="tag">腿</li><li className="tag">肩</li>
                  <li className="tag tag--opt">腹肌 · 可选</li><li className="tag tag--opt">有氧 · 可选</li>
                </ul>
              </article>
            </div>
            <p style={{ marginTop: 28 }}><Link className="btn btn--ghost" href="/welcome/method">看看每天怎么排</Link></p>
          </Reveal>
        </div>
      </section>

      {/* what's next */}
      <section className="sec" aria-labelledby="next">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">接下来</p>
            <h2 className="title" id="next">我们正在做的几件事。</h2>
            <div className="stack stack--3">
              {PLANNED.map(({ feature, icon }) => (
                <article key={feature.id} className="card card--flat">
                  <StatusBadge status={feature.status} />
                  {icon}
                  <h3 className="card__title" style={{ fontSize: 22, marginTop: 10 }}>{feature.name}</h3>
                  <p className="card__text">{feature.summary}</p>
                </article>
              ))}
            </div>
            <p style={{ marginTop: 28 }}><Link className="btn btn--ghost" href="/welcome/roadmap">看完整路线图</Link></p>
          </Reveal>
        </div>
      </section>

      {/* trust */}
      <section className="sec sec--mist" aria-labelledby="trust">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">放心用</p>
            <h2 className="title" id="trust">你的记录，说清楚怎么处理。</h2>
            <div className="trust">
              <div className="trust__item">
                <h3>数据怎么处理</h3>
                <p>记录保存在你自己的账号下。生成反馈时，会把当天记录的摘要发给 AI 服务商处理。收集什么、给谁、怎么处理，都写在隐私政策里。</p>
                <div className="links"><Link href="/privacy">隐私政策</Link><Link href="/terms">服务条款</Link></div>
              </div>
              <div className="trust__item">
                <h3>它不是医生</h3>
                <p>爪边不做诊断，不给治疗方案。反馈只是对你自己记录的整理和参考。有伤病、孕期或慢性病，请先问医生或专业教练。</p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* faq */}
      <section className="sec" aria-labelledby="faq">
        <div className="wrap">
          <p className="eyebrow">常见问题</p>
          <h2 className="title" id="faq">你大概会先问这些。</h2>
          <div className="faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p className="faq__a">
                  {item.a}
                  {item.href && <> <Link href={item.href.to}>{item.href.label}</Link></>}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* seed users + closing */}
      <section className="sec sec--ink on-ink" aria-labelledby="go">
        <div className="wrap seed">
          <div className="seed__copy">
            <h2 className="title" id="go">今天，就从第一组开始。</h2>
            <p className="lede">目前是内测阶段，现在就可以直接注册使用。</p>
            <p style={{ marginTop: 24 }}><Link href="/auth" className="btn btn--white">开始使用</Link></p>
            <div className="seed__perks">
              <p className="seed__perks-title">想早一点知道后续？留个邮箱，成为种子用户。</p>
              <ul className="list">
                <li>有新的内测安排和更新，优先发邮件告诉你。</li>
                <li>
                  {seedCredits.name}：{seedCredits.summary}
                  <span className="seed__tag">规划中</span>
                </li>
              </ul>
            </div>
          </div>
          <div className="seed__card">
            <CowCatPeek className="seed__cat" />
            <SeedForm />
          </div>
        </div>
      </section>
    </>
  )
}
