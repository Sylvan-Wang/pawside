/**
 * In-app tour content. Every step describes something a signed-in user can do
 * today — never a planned feature (see lib/site/features.ts for status).
 *
 * `since` is the tour version in which the step was added. A returning user who
 * last saw version N is only shown steps with since > N ("what's new"); a new
 * user, or someone replaying from Settings, sees all of them.
 */
export const TOUR_VERSION = 1

export type TourStep = {
  id: string
  since: number
  mood: 'wave' | 'peek'
  title: string
  body: string
  href?: string
  hrefLabel?: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'hello',
    since: 1,
    mood: 'wave',
    title: '你好，我是爪边的小猫',
    body: '接下来用不到一分钟，带你过一遍最常用的几个地方。随时可以跳过，也能在「设置」里重看。',
  },
  {
    id: 'today',
    since: 1,
    mood: 'peek',
    title: '今天练什么',
    body: '首页点「开始训练」，就能看到今天的部位、动作和每组目标。只有 30 分钟？在训练页可以先选短版。',
    href: '/training/today',
    hrefLabel: '去看今天的训练',
  },
  {
    id: 'log',
    since: 1,
    mood: 'peek',
    title: '做完一组，点一下',
    body: '逐组记录重量和次数。中途退出也没关系，回来会接着上次停下的地方。',
  },
  {
    id: 'food',
    since: 1,
    mood: 'peek',
    title: '吃了什么，写下来',
    body: '手动记录每餐，系统估算热量和蛋白质，给出当天的参考范围。',
    href: '/food',
    hrefLabel: '去记一餐',
  },
  {
    id: 'review',
    since: 1,
    mood: 'peek',
    title: '练完吃完，都有反馈',
    body: '每次训练、每天、每周都有一段文字反馈。「历史」看过往记录，「周报」看这一周的整体情况。',
    href: '/weekly',
    hrefLabel: '看周报',
  },
  {
    id: 'rest',
    since: 1,
    mood: 'wave',
    title: '休息不算掉队',
    body: '首页显示「本周训练 x/y 次」，目标可以在设置里改。按自己的节奏来，休息日不会被记成失败。',
  },
]

export function stepsFor(seenVersion: number): TourStep[] {
  return TOUR_STEPS.filter((step) => step.since > seenVersion)
}
