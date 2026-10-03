// 参考原型：确定性数量解析。已通过同目录 quantity-cases.json 的 22 条真实写法。不是生产代码，不要直接 import。
const CN: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function normalize(s: string): string {
  return s
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[－—–~～]/g, '-')
    .replace(/[至到]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[一二两三四五六七八九十]{1,3}/g, (m) => {
      if (m === '十') return '10'
      if (m.length === 2 && m[0] === '十') return String(10 + CN[m[1]])
      if (m.length === 2 && m[1] === '十') return String(CN[m[0]] * 10)
      if (m.length === 3 && m[1] === '十') return String(CN[m[0]] * 10 + CN[m[2]])
      return m.length === 1 ? String(CN[m]) : m
    })
}

type Range = { min: number; max: number } | null
function range(m: RegExpMatchArray | null, a = 1, b = 2): Range {
  if (!m) return null
  const min = Number(m[a])
  const max = m[b] ? Number(m[b]) : min
  return { min, max }
}

export function parse(raw: string) {
  const t = normalize(raw)
  const out: Record<string, unknown> = {}
  // 组数：N组 / N-M组 / 做N组 / 进行N组
  out.sets = range(t.match(/(\d+)(?:-(\d+))?组/))
  // 次数：每组N次 / N-M次
  out.reps = range(t.match(/(\d+)(?:-(\d+))?次/))
  // 休息：组间休息N秒 / 休息N-M分钟
  const unit = (m: RegExpMatchArray | null) => {
    if (!m) return null
    const k = m[3] === '秒' ? 1 : 60
    return { min: Number(m[1]) * k, max: Number(m[2] ?? m[1]) * k }
  }
  const betweenEx = t.match(/动作(?:之)?间休息(\d+)(?:-(\d+))?(秒|分钟|分)/)
  out.restBetweenExercisesSeconds = unit(betweenEx)
  const withoutBetweenEx = betweenEx ? t.replace(betweenEx[0], '') : t
  out.restSeconds = unit(withoutBetweenEx.match(/休息(\d+)(?:-(\d+))?(秒|分钟|分)/))
  out.failure = /力竭/.test(t) ? 'required_or_allowed' : /不(要)?(做到)?力竭|留.*余量/.test(t) ? 'avoid' : null
  out.perSide = /每侧|左右.{0,2}各|单侧/.test(t)
  const dur = t.match(/(\d+)(?:-(\d+))?(s|秒钟|min|分钟)(?!.*休息)/)
  out.duration = dur && !/休息/.test(t.slice(Math.max(0, dur.index! - 4), dur.index!))
    ? { min: Number(dur[1]) * (/s|秒/.test(dur[3]) ? 1 : 60), max: Number(dur[2] ?? dur[1]) * (/s|秒/.test(dur[3]) ? 1 : 60) } : null
  return out
}

// 来自四篇文章的真实写法，期望值手工标注
const cases: Array<[string, Record<string, unknown>]> = [
  ['每组8至10次，做3组，组间休息60秒', { sets: { min: 3, max: 3 }, reps: { min: 8, max: 10 }, restSeconds: { min: 60, max: 60 } }],
  ['每组10至12次，做3组，组间休息45秒', { sets: { min: 3, max: 3 }, reps: { min: 10, max: 12 }, restSeconds: { min: 45, max: 45 } }],
  ['每组10至12次，做2至3组，组间休息45秒', { sets: { min: 2, max: 3 }, reps: { min: 10, max: 12 }, restSeconds: { min: 45, max: 45 } }],
  ['杠铃深蹲：每组 5 次，进行5 组', { sets: { min: 5, max: 5 }, reps: { min: 5, max: 5 } }],
  ['罗马尼亚硬拉：每组 8 - 10 次，进行 3 - 4 组', { sets: { min: 3, max: 4 }, reps: { min: 8, max: 10 } }],
  ['保加利亚分腿蹲：每组 8 - 10 次，左右腿各进行 3 - 4 组', { sets: { min: 3, max: 4 }, reps: { min: 8, max: 10 }, perSide: true }],
  ['哑铃提踵：每组 12 -16次，进行 4-6 组，（组间休息 1 -2分钟）', { sets: { min: 4, max: 6 }, reps: { min: 12, max: 16 }, restSeconds: { min: 60, max: 120 } }],
  ['器械髋内收： 3 - 4 组，每组 12 - 16 次，锻炼大腿内侧肌肉', { sets: { min: 3, max: 4 }, reps: { min: 12, max: 16 } }],
  ['负重臀桥：每组 12 - 15 次，进行 3 - 4 组', { sets: { min: 3, max: 4 }, reps: { min: 12, max: 15 } }],
  ['腿弯举：使每组 10 - 12 次，进行 3 - 4 组', { sets: { min: 3, max: 4 }, reps: { min: 10, max: 12 } }],
  ['硬拉：4 组，每组 6 - 8 次', { sets: { min: 4, max: 4 }, reps: { min: 6, max: 8 } }],
  ['坐姿器械划船或杠铃划船：4 组，每组 8 - 10 次', { sets: { min: 4, max: 4 }, reps: { min: 8, max: 10 } }],
  ['高位下拉：4 组，每组 8 - 12 次', { sets: { min: 4, max: 4 }, reps: { min: 8, max: 12 } }],
  ['面拉：4 组，每组 12 - 16 次', { sets: { min: 4, max: 4 }, reps: { min: 12, max: 16 } }],
  ['每个动作之间休息 4-6 分钟，组间休息 2-3 分钟', { restBetweenExercisesSeconds: { min: 240, max: 360 }, restSeconds: { min: 120, max: 180 } }],
  ['引体向上（辅助器械或弹力带辅助）：4 组，每组力竭', { sets: { min: 4, max: 4 }, reps: null, failure: 'required_or_allowed' }],
  ['平板杠铃卧推：4 组，每组 8-12 次（重量从热身组到极限重量递减）', { sets: { min: 4, max: 4 }, reps: { min: 8, max: 12 } }],
  ['双杠臂屈伸（胸肌下束 + 三头肌）组数：3 组，每组力竭', { sets: { min: 3, max: 3 }, reps: null, failure: 'required_or_allowed' }],
  ['吊杠2-3组 30s', { sets: { min: 2, max: 3 }, duration: { min: 30, max: 30 } }],
  ['有氧15min', { duration: { min: 900, max: 900 } }],
  ['五组，每组十二次', { sets: { min: 5, max: 5 }, reps: { min: 12, max: 12 } }],
  ['动态拉伸 5 - 10 分钟', { duration: { min: 300, max: 600 } }],
]

let pass = 0
const fails: string[] = []
for (const [text, expect] of cases) {
  const got = parse(text) as Record<string, unknown>
  const bad = Object.entries(expect).filter(([k, v]) => JSON.stringify(got[k] ?? null) !== JSON.stringify(v))
  if (bad.length === 0) pass++
  else fails.push(`${text}\n    期望 ${JSON.stringify(Object.fromEntries(bad))}\n    实际 ${JSON.stringify(Object.fromEntries(bad.map(([k]) => [k, got[k] ?? null])))}`)
}
console.log(`通过 ${pass}/${cases.length}`)
for (const f of fails) console.log('  ✗ ' + f)
