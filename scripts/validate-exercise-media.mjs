import { getAssetUrl, getExercise } from '@bryllim/workout-guide'

const mappings = [
  ['杠铃卧推', 'bench-press', 'Bench Press', 'confirmed'],
  ['上斜哑铃卧推', 'incline-dumbbell-press', 'Incline Dumbbell Press', 'confirmed'],
  ['双杠臂屈伸', 'chest-dip', 'Chest Dip', 'candidate'],
  ['仰卧杠铃臂屈伸', 'skull-crusher', 'Skull Crusher', 'confirmed'],
  ['Y 字侧平举', 'prone-y-raise', 'Prone Y Raise', 'candidate'],
  ['对握高位下拉', 'close-grip-lat-pulldown', 'Close-Grip Lat Pulldown', 'candidate'],
  ['坐姿开肘划船', 'seated-row', 'Seated Cable Row', 'candidate'],
  ['坐姿肩屈位绳索弯举', 'cable-curl', 'Cable Curl', 'candidate'],
  ['单腿硬拉', 'single-leg-romanian-deadlift', 'Single-Leg Romanian Deadlift', 'candidate'],
  ['保加利亚分腿蹲', 'bulgarian-split-squat', 'Bulgarian Split Squat', 'confirmed'],
  ['前蹲/颈前深蹲', 'front-squat', 'Front Squat', 'confirmed'],
  ['罗马尼亚硬拉', 'romanian-deadlift', 'Romanian Deadlift', 'confirmed'],
  ['山羊挺身', 'back-extension', 'Back Extension', 'confirmed'],
]

let failed = false

for (const [pawsideName, slug, expectedName, status] of mappings) {
  const exercise = getExercise(slug)
  const urls = [1, 2, 3].map((frame) => getAssetUrl(slug, frame, { version: '1.0.0' }))
  const valid = exercise?.name === expectedName && urls.every((url) => (
    typeof url === 'string' &&
    url.startsWith('https://cdn.jsdelivr.net/npm/@bryllim/workout-guide@1.0.0/assets/')
  ))

  console.log(`${valid ? 'PASS' : 'FAIL'} ${pawsideName} -> ${slug} [${status}]`)
  if (!valid) failed = true
}

if (failed) process.exitCode = 1
