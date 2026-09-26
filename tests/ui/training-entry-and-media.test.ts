import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('training entry semantics and exercise media contrast', () => {
  it('keeps Method activation separate from free workout recording', async () => {
    const [home, workout] = await Promise.all([
      readFile('app/home/page.tsx', 'utf8'),
      readFile('app/workout/page.tsx', 'utf8'),
    ])

    expect(home).toContain("{ label: '记录自由训练', href: '/workout'")
    expect(home).toContain("? '启用训练方法'")
    expect(home).not.toContain('开始自由训练')
    expect(home).toContain('<Link key={href} href={href} prefetch')
    expect(workout).toContain('title="记录自由训练"')
  })

  it('uses a shared deep-gray media surface for white exercise artwork', async () => {
    const motion = await readFile('components/workout/ExerciseMotion.tsx', 'utf8')

    expect(motion).toContain('bg-neutral-800')
    expect(motion).toContain('text-neutral-300')
    expect(motion).not.toContain('bg-gray-50')
  })

  it('keeps API authentication in route handlers instead of duplicating it in the page proxy', async () => {
    const proxy = await readFile('proxy.ts', 'utf8')

    expect(proxy).toContain("api(?:/|$)")
    expect(proxy).toContain('Every API route performs its own authenticated user check')
  })

  it('keeps catalog animations static and lazy until the user opens one exercise', async () => {
    const [method, today, motion] = await Promise.all([
      readFile('app/training/method/page.tsx', 'utf8'),
      readFile('app/training/today/page.tsx', 'utf8'),
      readFile('components/workout/ExerciseMotion.tsx', 'utf8'),
    ])

    expect(method).toContain('animate={false} loading="lazy"')
    expect(today).toContain('animate={false} loading="lazy"')
    expect(motion).toContain('decoding="async"')
  })

  it('renders one live exercise and preloads only the next exercise in the background', async () => {
    const session = await readFile('app/training/sessions/[sessionId]/page.tsx', 'utf8')

    expect(session).toContain('const exercise = data.exercises[activeExerciseIndex]')
    expect(session).toContain('data?.exercises[activeExerciseIndex + 1]?.media')
    expect(session).toContain('nextMedia.frames.forEach')
    expect(session).toContain('上一个动作')
    expect(session).toContain('下一个动作')
  })

  it('prebuilds Method detail routes and shows a training route skeleton', async () => {
    const [detail, loading] = await Promise.all([
      readFile('app/training/method/[exerciseKey]/page.tsx', 'utf8'),
      readFile('app/training/loading.tsx', 'utf8'),
    ])

    expect(detail).toContain('export function generateStaticParams()')
    expect(loading).toContain('aria-busy="true"')
  })

  it('warms training payloads before navigation and clears them across authentication boundaries', async () => {
    const [home, today, session, auth, settings, cache] = await Promise.all([
      readFile('app/home/page.tsx', 'utf8'),
      readFile('app/training/today/page.tsx', 'utf8'),
      readFile('app/training/sessions/[sessionId]/page.tsx', 'utf8'),
      readFile('app/auth/page.tsx', 'utf8'),
      readFile('app/settings/page.tsx', 'utf8'),
      readFile('lib/training-navigation-cache.ts', 'utf8'),
    ])

    expect(home).toContain('fetch(`/api/training/today?${query}`')
    expect(home).toContain('writeTodayTrainingCache(payload.data, splitKey)')
    expect(today).toContain('readTodayTrainingCache<TodayTrainingPayload>(selectedSplit)')
    expect(today).toContain('warmTrainingSessionCache(activeSessionId)')
    expect(today).toContain('void warmTrainingSessionCache(sessionId)')
    expect(today).toContain('router.push(sessionUrl)')
    expect(session).toContain('readTrainingSessionCache<SessionResponse>(sessionId)')
    expect(session).toContain('await warmTrainingSessionCache<SessionResponse>(sessionId)')
    expect(cache).toContain('const pendingSessionLoads = new Map')
    expect(cache).toContain('const CACHE_TTL_MS = 60_000')
    expect(auth).toContain('clearTrainingNavigationCache()')
    expect(settings).toContain('clearTrainingNavigationCache()')
  })
})
