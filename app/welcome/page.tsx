import type { Metadata } from 'next'
import Link from 'next/link'
import JsonLd from '@/components/site/JsonLd'
import PhoneDemo, { type DemoStep } from '@/components/site/PhoneDemo'
import Reveal from '@/components/site/Reveal'
import StatusBadge from '@/components/site/StatusBadge'
import {
  CatWithDumbbell,
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
  ScreenMeal,
  ScreenPlan,
  ScreenReturn,
  ScreenReview,
  ScreenSet,
} from '@/components/site/screens'
import { CONTACT_EMAIL, FAQ, SITE_NAME, SITE_URL, OG_IMAGE } from '@/lib/site/content'
import { featureById } from '@/lib/site/features'

const TITLE = '爪边 Pawside｜今天练什么，打开就知道'
const DESCRIPTION =
  '给没有私教的你：选一套训练方法，每天打开就知道练什么、每组做多少；吃了什么写一句，晚上看蛋白质还差多少。'

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/welcome' },
  openGraph: { type: 'website', locale: 'zh_CN', siteName: '爪边 Pawside', title: TITLE, description: DESCRIPTION, url: '/welcome', images: [OG_IMAGE] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
}

const STEPS: DemoStep[] = [
  { id: 'plan', num: '01', title: '站在器械前，不用发愣', desc: '打开就是今天的部位、动作和每组目标。不用自己排。' },
  { id: 'set', num: '02', title: '这一组做到什么程度，写在这儿', desc: '热身组、正式组、休息-暂停组，目标和做法都写在组旁边。做完点一下。' },
  { id: 'meal', num: '03', title: '吃了啥，写一句', desc: '热量和蛋白质替你估好，对照当天的参考范围看就行。' },
  { id: 'review', num: '04', title: '练完，一段话说清', desc: '哪几组做到了，下一次的重点是哪一组。' },
  { id: 'return', num: '05', title: '周三没去？周五接着练', desc: '下一次练什么，由练没练完决定，不看星期几。' },
]

const THOUGHTS = [
  { where: '站在器械前', say: '「下一个练什么来着？」', icon: <IconDumbbell /> },
  { where: '下班只剩 40 分钟', say: '「练，还是不练？」', icon: <IconClock /> },
  { where: '周三没去，周五才去', say: '「是不是又断了？」', icon: <IconMoon /> },
  { where: '吃完外卖', say: '「这顿，蛋白够吗？」', icon: <IconBowl /> },
]

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
              爪边陪你自学健身。选一套训练方法，它每天排好今天练什么、每组做多少；吃了什么写一句，晚上告诉你蛋白质还差多少。不用请教练，也不用认得器械名字。
            </p>
            <div className="hero__cta">
              <Link href="/auth" className="btn btn--ink">开始使用</Link>
              <a href="#demo" className="btn btn--ghost">先看看怎么用</a>
            </div>
            <p className="hero__note">手机浏览器打开即可，也能添加到主屏幕。</p>
          </div>
          <CatWithDumbbell className="hero__art" />
        </div>
        <PawTrail className="hero__trail" />
      </section>

      {/* the moments */}
      <section className="sec sec--warm" aria-labelledby="moments">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">是不是也这样</p>
            <h2 className="title" id="moments">看了很多教程，练的时候还是会愣住。</h2>
            <div className="thoughts">
              {THOUGHTS.map((item) => (
                <div key={item.where} className="thought">
                  <span className="thought__icon">{item.icon}</span>
                  <p className="thought__where">{item.where}</p>
                  <p className="thought__say">{item.say}</p>
                </div>
              ))}
            </div>
            <p className="thoughts__answer">爪边做的事：把这几个念头，一个个收掉。</p>
          </Reveal>
        </div>
      </section>

      {/* demo */}
      <section className="sec" id="demo" aria-labelledby="demo-title">
        <div className="wrap">
          <p className="eyebrow">一天怎么用</p>
          <h2 className="title" id="demo-title">从站到器械前，到晚上看总结。</h2>
          <p className="lede">点任意一步，手机里就会切到对应的界面。</p>
          <PhoneDemo
            steps={STEPS}
            screens={[<ScreenPlan key="plan" />, <ScreenSet key="set" />, <ScreenMeal key="meal" />, <ScreenReview key="review" />, <ScreenReturn key="return" />]}
          />
        </div>
      </section>

      {/* rest is not failure */}
      <section className="sec sec--ink band on-ink" aria-labelledby="rest">
        <div className="wrap">
          <Reveal>
            <h2 className="band__big" id="rest">
              休息，<span className="hl">不是失败。</span>
            </h2>
            <p className="band__sub">
              训练日是一圈一圈轮着排的。没练完的那一天，会一直停在原位，等你回来。
            </p>
            <RotationPath labels={['推', '拉', '腿']} />
          </Reveal>
        </div>
      </section>

      {/* methods */}
      <section className="sec sec--warm" aria-labelledby="methods">
        <div className="wrap">
          <Reveal>
            <p className="eyebrow">训练方法</p>
            <h2 className="title" id="methods">选一套，之后就照着它来。</h2>
            <p className="lede">不用每天重新决定练什么。你选好方法，每个训练日按顺序轮。</p>
            <div className="cards2">
              <article className="card">
                <h3 className="card__title">三分化</h3>
                <p className="card__sub">三天轮一圈</p>
                <p className="card__text">
                  把全身分成推、拉、腿三块。推日练胸、肩和手臂后侧，拉日练背和手臂前侧，腿日练腿。每一块练完，留足时间恢复，再轮到它。
                </p>
                <ul className="tags" aria-label="训练日"><li className="tag">推</li><li className="tag">拉</li><li className="tag">腿</li></ul>
              </article>
              <article className="card">
                <h3 className="card__title">四分化</h3>
                <p className="card__sub">四天轮一圈</p>
                <p className="card__text">
                  把全身分成胸、背、腿、肩四天，每个部位练得更集中。另外有腹肌日和有氧日两个可选的日子，不算在一圈里。
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
            <p className="lede">角标写着「规划中」的，现在还不能用。</p>
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

      {/* closing */}
      <section className="sec sec--ink on-ink" style={{ textAlign: 'center' }} aria-labelledby="go">
        <div className="wrap">
          <h2 className="title" id="go" style={{ fontSize: 'clamp(30px, 5vw, 52px)' }}>今天，就从第一组开始。</h2>
          <p className="lede" style={{ marginInline: 'auto', maxWidth: 520 }}>目前是内测阶段，可以直接注册使用。</p>
          <p style={{ marginTop: 28 }}><Link href="/auth" className="btn btn--white">开始使用</Link></p>
        </div>
      </section>
    </>
  )
}
