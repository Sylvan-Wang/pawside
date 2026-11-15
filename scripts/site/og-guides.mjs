/**
 * 给每篇训练指南生成分享图：public/og/guides/<slug>.png（1200×630）。
 *
 * 做法：以首页分享图 public/og/welcome.png 为底（保留左上角的「爪边 Pawside」和右边的奶牛猫），
 * 把左边的大字盖掉，换成「训练指南」和文章标题。标题在第一个「：」或「，」处断成主标题和副标题。
 *
 * 用法（新增或改了文章标题后跑一次，把生成的图一起提交）：
 *   node scripts/site/og-guides.mjs
 *
 * 需要 Playwright（云端会话已预装）和一款中文字体。tests/site/guides.test.ts 会检查每篇文章都有图。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

// 只读出 slug 和 title，避免为了一个脚本引入 TS 编译。
const source = readFileSync(join(ROOT, 'lib/site/guides.ts'), 'utf8')
const guides = [...source.matchAll(/slug: '([a-z0-9-]+)',\s*\n\s*title: '([^']+)'/g)].map((m) => ({ slug: m[1], title: m[2] }))
if (guides.length === 0) throw new Error('没有从 lib/site/guides.ts 读到文章')

const base = readFileSync(join(ROOT, 'public/og/welcome.png')).toString('base64')
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function html({ title }) {
  const cut = title.search(/[：，]/)
  const [head, sub] = cut > 0 ? [title.slice(0, cut), title.slice(cut + 1)] : [title, '']
  const size = head.length <= 6 ? 96 : head.length <= 8 ? 76 : 68
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; background: #faf7f2 url(data:image/png;base64,${base}) no-repeat 0 0; font-family: 'PingFang SC', 'Noto Sans SC', 'WenQuanYi Zen Hei', sans-serif; color: #111; position: relative; }
    .cover { position: absolute; left: 60px; top: 180px; width: 600px; height: 330px; background: #faf7f2; }
    .text { position: absolute; left: 84px; top: 196px; width: 580px; }
    .tag { display: inline-block; font-size: 26px; font-weight: 700; padding: 6px 16px; border: 2px solid #111; border-radius: 999px; }
    h1 { margin-top: 28px; font-size: ${size}px; line-height: 1.15; font-weight: 800; letter-spacing: -1px; word-break: keep-all; }
    h1 span { background: linear-gradient(transparent 62%, #ffe45c 62%); }
    p { margin-top: 22px; font-size: 32px; line-height: 1.4; color: #3a3a3a; }
  </style></head><body><div class="cover"></div><div class="text">
    <span class="tag">训练指南</span>
    <h1><span>${escape(head)}</span></h1>
    ${sub ? `<p>${escape(sub)}</p>` : ''}
  </div></body></html>`
}

const outDir = join(ROOT, 'public/og/guides')
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
for (const guide of guides) {
  await page.setContent(html(guide))
  await page.screenshot({ path: join(outDir, `${guide.slug}.png`) })
  console.log(`public/og/guides/${guide.slug}.png`)
}
await browser.close()
