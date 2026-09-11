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
})
