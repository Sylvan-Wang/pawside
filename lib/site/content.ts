/** Public contact + canonical site facts. One place, so every page agrees. */
export const SITE_URL = 'https://paw-side.com'
export const CONTACT_EMAIL = 'refrigerium@qq.com'
export const SITE_NAME = '爪边 Pawside'
export const UPDATED_YEAR = 2026

export interface FaqItem { q: string; a: string; href?: { label: string; to: string } }

/**
 * Written in the reader's words (docs/marketing/MESSAGE_HOUSE.md §8). The same
 * array feeds the visible FAQ and the FAQPage JSON-LD, so they cannot drift.
 */
export const FAQ: FaqItem[] = [
  {
    q: '我不懂器械，能用吗？',
    a: '能。每个动作都有示意动画，每一组都写着是什么组、做几次。看不懂的名字，会用一句话讲清楚。',
  },
  {
    q: '没有健身房可以吗？',
    a: '注册时会问你有什么器材。如果当前方法需要的器材你没有，应用会告诉你，让你改训练条件。',
  },
  {
    q: '断了几天，还能接着练吗？',
    a: '能。下一次练什么，由你练没练完决定，不看今天星期几。没练完的那一天，会一直在原位。',
  },
  {
    q: '饮食怎么记？',
    a: '写下吃了什么、大概多少，应用估算热量和蛋白质。份量按自己的估计填就行，数字是参考，不是必须吃满的处方。',
  },
  {
    q: '它会告诉我该怎么吃吗？',
    a: '会给你每天热量和蛋白质的参考范围，按早午晚拆开，可以按作息和饥饿感调整。它不开营养处方。',
  },
  {
    q: '反馈是 AI 写的吗？会不会说错？',
    a: '是 AI 根据你当天的记录写的。它会出错，所以反馈里的数字都取自你自己记录的内容，程序会检查；觉得不准，点一下 👎 就行。',
  },
  {
    q: '现在能和它聊天吗？',
    a: '还不能。陪你练的小伙伴在规划中，路线图里有。',
    href: { label: '看路线图', to: '/welcome/roadmap' },
  },
  {
    q: '要付费吗？',
    a: '现在是内测阶段，可以直接注册使用。以后是否收费还没定。',
  },
  {
    q: '它会替我做医疗判断吗？',
    a: '不会。它不做诊断，不给治疗方案。有伤病、孕期或慢性病，请先问医生或专业教练。',
  },
  {
    q: '我的数据怎么处理？',
    a: '记录保存在你自己的账号下。生成反馈时，会把当天记录的摘要发给 AI 服务商处理。具体收集什么、给谁、怎么处理，都写在隐私政策里。',
    href: { label: '读隐私政策', to: '/privacy' },
  },
]

/** Link-preview image (1200×630 PNG; platforms such as WeChat do not render SVG). */
export const OG_IMAGE = { url: '/og/welcome.png', width: 1200, height: 630, alt: '爪边 Pawside：今天练什么，打开就知道' }
