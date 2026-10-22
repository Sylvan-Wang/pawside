// Browser end-to-end check of the chat against a running app + the local stand-ins
// (scripts/local-supabase/README.md). Drives real Chromium at phone size.
//   node scripts/local-supabase/e2e-browser.mjs [screenshotDir]
// The "model" here is fake-openai.mjs: it understands a fixed set of phrases, so this checks the
// product path (UI -> routes -> database), not how well a real model understands people.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mintToken } from './jwt.mjs'

const require = createRequire('/opt/node22/lib/node_modules/')
const { chromium } = require('playwright')

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3100'
const SECRET = process.env.PAWSIDE_IT_JWT_SECRET ?? 'pawside-local-test-secret-0123456789abcdef'
const COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sb-127-auth-token'
const PSQL = (process.env.PAWSIDE_IT_PSQL ?? 'psql -h /tmp/pgdata -p 54329 -U postgres -d pawtest').split(' ')
const shots = process.argv[2]
if (shots) mkdirSync(shots, { recursive: true })

const sql = (statement) => execFileSync(PSQL[0], [...PSQL.slice(1), '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-q', '-c', statement], { encoding: 'utf8' }).trim()
const results = []
let activePage = null
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message ?? error).split('\n')[0] })
    if (shots && activePage) await activePage.screenshot({ path: `${shots}/FAIL-${results.length}.png` }).catch(() => {})
    console.log(`FAIL  ${name}\n      ${String(error?.message ?? error).split('\n')[0]}`)
  }
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }

function newUser({ granted = true } = {}) {
  const id = crypto.randomUUID()
  sql(`insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${id}@pawside.test','',now(),'{}','{}',now(),now())`)
  sql(`update public.user_profiles set onboarding_completed = true where id = '${id}'`)
  if (granted) sql(`insert into public.user_features values ('${id}','coach_chat')`)
  return id
}

function sessionCookie(userId) {
  const token = mintToken(SECRET, { role: 'authenticated', sub: userId })
  const session = { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'local', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: `${userId}@pawside.test` } }
  return { name: COOKIE, value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'), url: APP }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const users = []

async function session(userId, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...options })
  await context.addCookies([sessionCookie(userId)])
  return context
}
const launcher = (page) => page.locator('button[aria-label="打开小爪"]')
const panel = (page) => page.locator('[role=dialog][aria-label="小爪"]')
const input = (page) => page.locator('textarea[aria-label="消息"]')
async function say(page, text) {
  await input(page).fill(text)
  await page.getByRole('button', { name: '发送' }).click()
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }) }

try {
  const me = newUser()
  users.push(me)
  const context = await session(me)
  const page = await context.newPage()
  activePage = page
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await check('the cat shows on logging pages for a granted user, and opens a panel with the greeting', async () => {
    await page.goto(`${APP}/food`, { waitUntil: 'networkidle' })
    await launcher(page).waitFor({ timeout: 10000 })
    await shot(page, '1-launcher')
    await launcher(page).click()
    await panel(page).waitFor()
    await page.getByText('嗨，我是小爪').waitFor()
    await shot(page, '2-panel-empty')
    for (const label of ['记一餐', '记运动', '记体重', '今天情况', '吃什么']) await page.getByRole('button', { name: label }).waitFor()
  })

  await check('the panel fits a phone screen: no horizontal scroll, input and send are on screen', async () => {
    const box = await panel(page).boundingBox()
    assert(box && box.width <= 390 && box.x >= 0, `panel box ${JSON.stringify(box)}`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    assert(!overflow, 'page scrolls horizontally')
    const send = await page.getByRole('button', { name: '发送' }).boundingBox()
    assert(send && send.y + send.height <= 844, 'send button is off screen')
  })

  await check('a meal sentence becomes a card; nothing is saved until the button is tapped', async () => {
    await say(page, '中午吃了200克米饭和两个鸡蛋')
    await page.getByText('帮你整理了午餐').waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '确认保存' }).waitFor()
    await shot(page, '3-meal-card')
    assert(sql(`select count(*) from public.user_food_logs where user_id='${me}'`) === '0', 'saved before confirm')
    const cardText = await panel(page).innerText()
    assert(cardText.includes('米饭') && cardText.includes('鸡蛋') && cardText.includes('估算'), 'card content missing')
  })

  await check('confirming saves exactly one meal and the card turns into "已保存"', async () => {
    await page.getByRole('button', { name: '确认保存' }).click()
    await page.getByText('已保存', { exact: true }).waitFor({ timeout: 15000 })
    assert(sql(`select count(*) from public.user_food_logs where user_id='${me}'`) === '1', 'expected one meal')
    assert(sql(`select input_mode from public.user_food_logs where user_id='${me}'`) === 'ai_assisted', 'input mode')
    assert((await page.getByRole('button', { name: '确认保存' }).count()) === 0, 'confirm button still shown')
    await shot(page, '4-saved')
  })

  await check('"刚才那顿只吃了一半" proposes an edit; confirming halves the saved meal once', async () => {
    await say(page, '刚才那顿只吃了一半')
    await page.getByText('按你说的改了').waitFor({ timeout: 15000 })
    assert(sql(`select weight_g from public.user_food_log_items where food_name_raw='米饭' and food_log_id in (select id from public.user_food_logs where user_id='${me}')`) === '200.00', 'changed before confirm')
    await page.getByRole('button', { name: '确认保存' }).click()
    await page.getByText('午餐已更新').waitFor({ timeout: 15000 })
    assert(sql(`select weight_g from public.user_food_log_items where food_name_raw='米饭' and food_log_id in (select id from public.user_food_logs where user_id='${me}')`) === '100.00', 'not halved')
    assert(sql(`select count(*) from public.user_food_logs where user_id='${me}'`) === '1', 'edit created a second meal')
    await shot(page, '5-edited')
  })

  await check('weight and workout cards save through the same confirm step', async () => {
    await say(page, '体重72.5')
    await page.getByText('体重整理好了').waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '确认保存' }).last().click()
    await page.getByText('体重已记下').waitFor({ timeout: 15000 })
    assert(sql(`select weight_kg from public.body_metrics where user_id='${me}'`) === '72.500', 'weight')
    await say(page, '游泳40分钟')
    await page.getByText('运动整理好了').waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: '确认保存' }).last().click()
    await page.getByText('运动已记下').waitFor({ timeout: 15000 })
    assert(sql(`select type || duration_minutes from public.workout_logs where user_id='${me}'`) === '有氧40', 'workout')
  })

  await check('"今天情况" answers from the records, and writes nothing', async () => {
    const before = sql(`select (select count(*) from public.coach_drafts where user_id='${me}')`)
    await page.getByRole('button', { name: '今天情况' }).click()
    await page.getByText('今天已记录').waitFor({ timeout: 15000 })
    assert((await panel(page).innerText()).includes('体重：72.5 kg'), 'weight not reported')
    assert(sql(`select count(*) from public.coach_drafts where user_id='${me}'`) === before, 'a question created a draft')
    await shot(page, '6-day-facts')
  })

  await check('"算了不记了" cancels an open card without saving', async () => {
    await say(page, '晚上吃了100克面条')
    await page.getByText('帮你整理了').last().waitFor({ timeout: 15000 })
    await say(page, '算了不记了')
    await page.getByText('好，这条不记了。').last().waitFor({ timeout: 15000 })
    // the original card must not keep offering a button that no longer applies
    await page.getByText('已取消').first().waitFor({ timeout: 5000 })
    assert((await page.getByRole('button', { name: '确认保存' }).count()) === 0, 'a confirm button is still offered')
    assert(sql(`select count(*) from public.user_food_logs where user_id='${me}'`) === '1', 'cancelled meal was saved')
  })

  await check('going offline keeps the message with a retry, and the retry does not duplicate it', async () => {
    await context.setOffline(true)
    await say(page, '体重73')
    await page.getByRole('button', { name: /重试/ }).waitFor({ timeout: 15000 })
    await shot(page, '7-offline')
    await context.setOffline(false)
    await page.getByRole('button', { name: /重试/ }).click()
    await page.getByText('体重整理好了').last().waitFor({ timeout: 15000 })
    assert(sql(`select count(*) from public.coach_messages where user_id='${me}' and role='user' and content='体重73'`) === '1', 'message duplicated')
  })

  await check('a question with options is answered by tapping, and the answer completes the workout card', async () => {
    await say(page, '我今天跑步了')
    await page.getByText('大概做了多久呢？').last().waitFor({ timeout: 15000 })
    await shot(page, '7b-question')
    await page.getByRole('button', { name: '半小时' }).click()
    await page.getByText('有氧 · 30 分钟').waitFor({ timeout: 15000 })
    // the question is closed once answered
    assert((await page.getByRole('button', { name: '半小时' }).count()) === 0, 'the answered question still shows its options')
  })

  await check('reloading the page restores the conversation, with the saved card still saved', async () => {
    await page.reload({ waitUntil: 'networkidle' })
    await launcher(page).click()
    await page.getByText('中午吃了200克米饭和两个鸡蛋').waitFor({ timeout: 10000 })
    assert((await page.getByText('已保存', { exact: true }).count()) >= 1, 'saved card not restored')
  })

  await check('clearing the chat empties it but keeps the meal, weight and workout that were saved', async () => {
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '清空对话' }).click()
    await page.getByText('嗨，我是小爪').waitFor({ timeout: 10000 })
    assert(sql(`select count(*) from public.coach_messages where user_id='${me}'`) === '0', 'messages remain')
    assert(sql(`select count(*) from public.user_food_logs where user_id='${me}'`) === '1', 'the saved meal was removed')
    assert(sql(`select count(*) from public.body_metrics where user_id='${me}'`) === '1', 'the saved weight was removed')
    assert(sql(`select count(*) from public.workout_logs where user_id='${me}'`) === '1', 'the saved workout was removed')
  })

  await check('the Escape key closes the panel and the cat is still there', async () => {
    await page.keyboard.press('Escape')
    await panel(page).waitFor({ state: 'hidden' })
    await launcher(page).waitFor()
  })

  await check('the saved meal is visible on the existing history page, with no broken wording', async () => {
    const today = sql(`select log_date from public.user_food_logs where user_id='${me}'`)
    await page.goto(`${APP}/history/${today}`, { waitUntil: 'networkidle' })
    const text = await page.locator('body').innerText()
    assert(text.includes('米饭') && text.includes('鸡蛋'), 'meal missing on history page')
    assert(!/null|undefined|NaN/.test(text), 'history page shows a broken value')
    await shot(page, '8-history')
  })

  await check('the cat does not appear where it must not: training runner, login, onboarding, public site', async () => {
    for (const path of ['/training/sessions/00000000-0000-4000-8000-000000000000', '/onboarding', '/welcome', '/privacy']) {
      await page.goto(`${APP}${path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
      assert((await launcher(page).count()) === 0, `cat visible on ${path}`)
    }
  })

  await check('no uncaught browser errors during the whole run', async () => {
    assert(pageErrors.length === 0, pageErrors.join(' | '))
  })

  await check('a user who was not granted the assistant never sees the cat, even on the same page', async () => {
    const stranger = newUser({ granted: false })
    users.push(stranger)
    const ctx = await session(stranger)
    const p = await ctx.newPage()
    await p.goto(`${APP}/food`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(800)
    assert((await launcher(p).count()) === 0, 'cat visible to an ungranted user')
    const response = await p.request.post(`${APP}/api/coach/conversations`)
    assert(response.status() === 403, `expected 403, got ${response.status()}`)
    await ctx.close()
  })
} finally {
  for (const id of users) sql(`delete from auth.users where id='${id}'`)
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
