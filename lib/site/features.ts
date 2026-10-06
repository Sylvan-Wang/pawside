/**
 * Single source of truth for what the public website says Pawside can do.
 *
 * The site renders every feature mention, status badge and the roadmap from this
 * file. When user-visible behaviour changes, update this list in the same change
 * (CLAUDE.md requires it) and re-read the site copy. tests/site/site-copy.test.ts
 * checks the list and scans the site for claims we must not make.
 *
 * Status vocabulary (see docs/marketing/MESSAGE_HOUSE.md §8.5):
 *   live     – usable by anyone who signs up today; no badge.
 *   beta     – usable by beta testers today, not opened to everyone; badge "内测中".
 *   planned  – not usable yet; badge "规划中", concept art only.
 * Never mark something `beta` unless testers can really use it.
 */
export type FeatureStatus = 'live' | 'beta' | 'planned'

export interface SiteFeature {
  id: string
  name: string
  summary: string
  status: FeatureStatus
  /** false = known to exist or be coming, but must not appear on the site yet. */
  public: boolean
  /** Why a non-public item is held back (internal). */
  heldBackBecause?: string
}

export const SITE_FEATURES: SiteFeature[] = [
  { id: 'methods', name: '三分化与四分化', summary: '选一套训练方法，之后的训练日按它轮着排。', status: 'live', public: true },
  { id: 'today-plan', name: '今天练什么', summary: '打开就是今天的部位、动作和每组目标。', status: 'live', public: true },
  { id: 'set-guidance', name: '每组说明', summary: '每一组是热身、正式还是休息-暂停组，目标是多少，写在组旁边。', status: 'live', public: true },
  { id: 'exercise-motion', name: '动作示意', summary: '每个动作配示意动画。', status: 'live', public: true },
  { id: 'set-logging', name: '逐组记录', summary: '做完一组点一下，记下重量和次数。', status: 'live', public: true },
  { id: 'cardio', name: '有氧记录', summary: '跑步、骑行等自由训练，记录时间和距离，算出配速。', status: 'live', public: true },
  { id: 'meal-logging', name: '手动记录饮食', summary: '写下吃了什么，估算热量和蛋白质。', status: 'live', public: true },
  { id: 'nutrition-reference', name: '每日饮食参考', summary: '热量和蛋白质的参考范围，按餐拆开，仅作参考。', status: 'live', public: true },
  { id: 'reviews', name: '训练与饮食反馈', summary: '练完、吃完、每天、每周，各有一段文字反馈。', status: 'live', public: true },
  { id: 'recovery-selfcheck', name: '睡眠与恢复自评', summary: '用 1–5 分记下睡得怎么样、练后恢复得怎么样。', status: 'live', public: true },
  { id: 'food-photo', name: '拍照识别外卖', summary: '拍一张外卖或餐盘，自动认出食物。', status: 'planned', public: true },
  { id: 'companion', name: '陪你练的小伙伴', summary: '练的时候能陪你说话、帮你选下一步。', status: 'planned', public: true },
  { id: 'more-devices', name: '更多设备接入', summary: '把智能戒指、手表里的睡眠和活动，放进同一个地方看。', status: 'planned', public: true },
  {
    id: 'data-control',
    name: '导出全部数据、删除账号',
    summary: '在设置里导出自己的全部数据，或者删除账号。',
    status: 'live',
    public: false,
    heldBackBecause: '删除账号需要服务端密钥配置并实测通过后，才能对外说',
  },
]

export const publicFeatures = () => SITE_FEATURES.filter((feature) => feature.public)
export const featuresByStatus = (status: FeatureStatus) => publicFeatures().filter((feature) => feature.status === status)
export const featureById = (id: string) => {
  const feature = SITE_FEATURES.find((item) => item.id === id)
  if (!feature) throw new Error(`Unknown site feature: ${id}`)
  return feature
}

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  live: '已上线',
  beta: '内测中',
  planned: '规划中',
}
