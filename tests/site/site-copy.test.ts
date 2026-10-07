import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const SITE_FILES = [
  ...files(join(ROOT, 'app/welcome')),
  ...files(join(ROOT, 'components/site')),
  join(ROOT, 'lib/site/content.ts'),
  join(ROOT, 'app/privacy/page.tsx'),
  join(ROOT, 'app/terms/page.tsx'),
].filter((path) => /\.(tsx?|css)$/.test(path))

/**
 * Claims the public site must not make today, each with the reason. If one of these
 * becomes true, change the product, update lib/site/features.ts, and only then edit
 * this list.
 */
const FORBIDDEN: [RegExp, string][] = [
  [/邀请码/, '注册是开放的，没有邀请码机制'],
  [/断签/, '首页有连续打卡，不能写成不记录'],
  [/推送/, '产品没有任何推送功能'],
  [/固定模板/, '反馈文字由 AI 生成，不是固定模板'],
  [/不连任何硬件/, '以后会接设备'],
  [/Oura/i, '官网不提 Oura（协议限制，也避免暗示合作）'],
  [/保证(增肌|减脂|减重|见效)/, '不承诺结果'],
  [/(瘦|减)\s*\d+\s*(斤|公斤|kg)/i, '不承诺结果'],
  [/治愈|治疗效果|帮你(治疗|诊断)|(可以|能)(治疗|诊断)/, '不做医疗声明（免责声明里的“不做诊断”是允许的）'],
  [/自学健身/, '定位不是教程：解决的是“下次打开知道从哪继续”，不是教你学'],
  [/收掉|等你回来/, '不拟人、不鸡汤：写产品机制，不写情绪'],
  [/用户数|已有\s*\d+\s*(位|名|个)?用户|好评|评分/, '没有真实数据，不写'],
]

describe('public site copy', () => {
  for (const [pattern, why] of FORBIDDEN) {
    it(`never says ${pattern} (${why})`, () => {
      // The legal pages must name Oura (the integration is disclosed there); marketing must not.
      const scope = pattern.source === 'Oura' ? SITE_FILES.filter((path) => !/(privacy|terms)\/page\.tsx$/.test(path)) : SITE_FILES
      const hits = scope.filter((path) => pattern.test(readFileSync(path, 'utf8')))
      expect(hits.map((path) => path.replace(ROOT, ''))).toEqual([])
    })
  }

  it('uses only the product contact email', () => {
    for (const path of SITE_FILES) {
      const emails = readFileSync(path, 'utf8').match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
      for (const email of emails) expect(email).toBe('refrigerium@qq.com')
    }
  })

  it('has exactly one h1 per page', () => {
    for (const page of ['app/welcome/page.tsx', 'app/welcome/method/page.tsx', 'app/welcome/roadmap/page.tsx']) {
      const source = readFileSync(join(ROOT, page), 'utf8')
      expect(source.match(/<h1[\s>]/g)?.length).toBe(1)
    }
  })

  it('renders planned features only through the registry (so they always carry a badge)', () => {
    const home = readFileSync(join(ROOT, 'app/welcome/page.tsx'), 'utf8')
    expect(home).toMatch(/featureById\('food-photo'\)/)
    expect(home).toMatch(/<StatusBadge status=\{feature\.status\} \/>/)
  })
})
