import {
  buildWorkoutGuideMedia,
  type ExerciseMedia,
  type ExerciseMediaMappingStatus,
} from '@/lib/exercise-media'

export type MethodSplitKey = 'push' | 'pull' | 'legs'
export type MethodAuthority = 'method_explicit' | 'mixed_with_product_default'

export interface MethodExercise {
  key: string
  splitKey: MethodSplitKey
  order: number
  name: string
  role: string
  purpose: string
  prescription: string
  intensity: string
  progression: string
  cues: string[]
  why: string
  authority: MethodAuthority
  media: ExerciseMedia | null
}

export interface MethodSplit {
  key: MethodSplitKey
  day: string
  name: string
  focus: string
  exercises: MethodExercise[]
}

const attribution =
  'Original exercise artwork by Everkinetic, expanded by Bryl Lim, licensed under CC BY-SA 4.0.'

function media(
  externalSlug: string | null,
  mappingStatus: ExerciseMediaMappingStatus = 'candidate',
  mappingNotes: string | null = null,
) {
  if (!externalSlug) return null
  return buildWorkoutGuideMedia({
    provider: '@bryllim/workout-guide',
    external_slug: externalSlug,
    source_version: '1.0.0',
    license: 'CC BY-SA 4.0',
    attribution,
    source_url: 'https://bryllim.github.io/workout-guide/exercises/' + externalSlug + '/',
    mapping_status: mappingStatus,
    mapping_notes: mappingNotes,
  })
}

const exercises: MethodExercise[] = [
  {
    key: 'barbell_bench_press', splitKey: 'push', order: 1, name: '杠铃卧推', role: '主项',
    purpose: '推能力、协调稳定与力量主线', prescription: '热身 15 次；正式组 12 / 10 / 8 次',
    intensity: '约 RPE 8，不做到力竭', progression: '3×8 → 4×8 → 2/3/4×6 → 2/3/4×5',
    cues: ['眼睛位于杠铃正下方，先固定握距', '胸廓抬起、肩胛后缩，脚腿保持稳定', '用整体协同推起，不用变形换次数'],
    why: '作为主项保留自由重量，用于同时发展推力与全身稳定。',
    authority: 'method_explicit', media: media('bench-press', 'confirmed'),
  },
  {
    key: 'incline_dumbbell_press', splitKey: 'push', order: 2, name: '上斜哑铃卧推', role: '复合辅助',
    purpose: '上胸与动作技术', prescription: '4 组 × 12 次',
    intensity: '初期留 2–3 次余量，后期接近力竭', progression: '末组提升至 RPE 9–9.5，再逐步增加力竭组',
    cues: ['凳角约 45°，按身体与器械微调', '下放时打开胸腔、肩胛自然内收', '不要刻意执行沉肩指令'],
    why: '在主项之后补充上胸刺激，同时保留较稳定的技术练习量。',
    authority: 'method_explicit', media: media('incline-dumbbell-press', 'confirmed'),
  },
  {
    key: 'parallel_bar_dip', splitKey: 'push', order: 3, name: '双杠臂屈伸', role: '复合辅助',
    purpose: '下胸、三头与肩胛协同', prescription: '4 组 × 12 次，或在能力范围内完成',
    intensity: '允许力竭，但以标准完成为前提', progression: '按动作能力与标准质量推进',
    cues: ['先确认能够稳定支撑', '在可控幅度内完成', '无法标准完成时立即退阶'],
    why: '用自重复合动作连接胸、三头和肩胛控制。',
    authority: 'method_explicit', media: media('chest-dip', 'candidate', '需确认躯干角度与 Method 动作意图。'),
  },
  {
    key: 'lying_barbell_triceps_extension', splitKey: 'push', order: 4, name: '仰卧臂屈伸（肩屈位）', role: '孤立辅助',
    purpose: '肱三头肌', prescription: '4 组 × 15 次',
    intensity: '约 RPE 8，不力竭', progression: '逐步到 4×12，再让末 2 组力竭后加重',
    cues: ['保持肩屈位与肘部路径稳定', '用三头完成伸肘', '动作变形前停止'],
    why: '在复合推举后，用更聚焦的方式补足三头训练量。',
    authority: 'method_explicit', media: media('skull-crusher', 'confirmed'),
  },
  {
    key: 'y_lateral_raise', splitKey: 'push', order: 5, name: 'Y 字侧平举', role: '孤立',
    purpose: '三角肌中束', prescription: '3 组 × 10 + 10 次，组内休息 5 秒',
    intensity: '基本力竭', progression: '长期递进仍待方法证据',
    cues: ['保持外旋位置', '以中束主导抬起', '借力或其他肌群明显参与时降重'],
    why: '用短暂停顿延长有效组，集中完成中束训练。',
    authority: 'method_explicit', media: media('prone-y-raise', 'candidate', '素材为俯卧 Y raise，需确认与 Method 示范一致。'),
  },
  {
    key: 'single_arm_cable_pulldown', splitKey: 'pull', order: 1, name: '单手绳索下拉', role: '技术 / 背阔优先',
    purpose: '背阔持续张力', prescription: '前 3 组 × 12 次；末组 10 + 5 次',
    intensity: '前 3 组不力竭；末组接近或达到力竭', progression: '先增加 10 + 5 组，动作质量稳定后再加重',
    cues: ['拉力方向匹配背阔走向', '减少侧屈、旋转与后仰', '离心保持张力，不把肩带完全送出去'],
    why: '先建立背阔发力与路径，再进入较重的下拉和划船。',
    authority: 'method_explicit', media: null,
  },
  {
    key: 'neutral_grip_lat_pulldown', splitKey: 'pull', order: 2, name: '对握高位下拉', role: '较重辅助',
    purpose: '圆肌与背阔', prescription: '4 组 × 8–12 次',
    intensity: '次数范围随熟练度调整', progression: '感觉不足时先做 12 次；熟练后增加 8 次重组',
    cues: ['保持对握路径稳定', '先保证目标肌发力', '不要为了加重牺牲动作质量'],
    why: '承接单手技术练习，在稳定路径中增加背部机械张力。',
    authority: 'method_explicit', media: media('close-grip-lat-pulldown', 'candidate', '接近对握下拉，握把和路径仍需人工确认。'),
  },
  {
    key: 'single_arm_machine_row', splitKey: 'pull', order: 3, name: '单手器械划船', role: '较重辅助',
    purpose: '背阔与机械张力', prescription: '前 3 组 × 10 次；末组 10 + 5 次',
    intensity: '前 3 组不力竭；末组采用力竭结构', progression: '增加 10 + 5 组，再减为 2 组并加重循环',
    cues: ['利用器械支点保持身体稳定', '用背阔拉，不靠身体抡', '肌感丢失时减小幅度或重量'],
    why: '用更多支点承载较高张力，同时减少躯干代偿。',
    authority: 'method_explicit', media: null,
  },
  {
    key: 'seated_elbows_out_row', splitKey: 'pull', order: 4, name: '坐姿开肘划船', role: '功能辅助',
    purpose: '中下斜方肌与肩胛后缩能力', prescription: '组次仍待严格方法证据',
    intensity: '强调感受与控制，不抡甩', progression: '长期递进仍待方法证据',
    cues: ['让轨迹匹配目标纤维', '主动完成肩胛内收', '不靠身体抡甩'],
    why: '补足肩胛后缩能力，不把它误当成单纯追重量的划船。',
    authority: 'method_explicit', media: media('seated-row', 'candidate', '通用坐姿绳索划船，开肘轨迹需人工确认。'),
  },
  {
    key: 'seated_shoulder_flexed_cable_curl', splitKey: 'pull', order: 5, name: '坐姿肩屈位绳索弯举', role: '孤立',
    purpose: '肱二头肌', prescription: '3 组 × 12–15 次',
    intensity: '动作质量优先；末组可接近技术性力竭', progression: '只校准参考重量，不创建或推进方法阶段',
    cues: ['保持坐姿与肩屈位稳定', '避免躯干借力', '技术开始破坏时结束该组'],
    why: '方法明确动作身份与 3 组；12–15 次是 Pawside V1 起始范围，不代表作者原话。',
    authority: 'mixed_with_product_default', media: media('cable-curl', 'candidate', '通用绳索弯举，肩屈位和坐姿需人工确认。'),
  },
  {
    key: 'single_leg_deadlift', splitKey: 'legs', order: 1, name: '单腿硬拉', role: '功能单侧',
    purpose: '髋、臀、腘绳肌与骨盆稳定', prescription: '3 组 × 每侧 12 次',
    intensity: '前期不到力竭', progression: '只校准参考重量，不创建或推进方法阶段',
    cues: ['保持骨盆稳定', '用髋铰链完成动作', '不稳定时轻扶支撑'],
    why: '方法明确动作顺序和稳定性目标；组次是 Pawside V1 起始处方。',
    authority: 'mixed_with_product_default', media: media('single-leg-romanian-deadlift', 'candidate', '最接近的单腿罗马尼亚硬拉，需确认 Method 版本。'),
  },
  {
    key: 'bulgarian_split_squat', splitKey: 'legs', order: 2, name: '保加利亚分腿蹲', role: '功能单侧',
    purpose: '骨盆稳定、臀中肌与臀小肌', prescription: '3 组 × 每侧 10–12 次',
    intensity: '前期不到力竭', progression: '只校准参考重量，不创建或推进方法阶段',
    cues: ['先建立稳定站距', '保持骨盆和膝部轨迹稳定', '按稳定能力调整幅度与负重'],
    why: '延续单侧稳定训练；组次是 Pawside V1 起始处方。',
    authority: 'mixed_with_product_default', media: media('bulgarian-split-squat', 'confirmed'),
  },
  {
    key: 'front_squat', splitKey: 'legs', order: 3, name: '前蹲 / 颈前深蹲', role: '复合功能',
    purpose: '股四头肌与全身功能', prescription: '3 组 × 12–15 次',
    intensity: '前期不到力竭', progression: '只校准参考重量，不创建或推进方法阶段',
    cues: ['保持前架位稳定', '躯干与膝部轨迹可控', '技术优先于负重'],
    why: '3 组来自方法；12–15 次是 Pawside V1 用于启动校准的范围。',
    authority: 'mixed_with_product_default', media: media('front-squat', 'confirmed'),
  },
  {
    key: 'romanian_deadlift', splitKey: 'legs', order: 4, name: '罗马尼亚硬拉', role: '复合后侧链',
    purpose: '髋铰链、臀、腘绳肌与躯干刚性', prescription: '3 组 × 10–12 次',
    intensity: '前期不到力竭，技术优先', progression: '只校准参考重量，不创建或推进方法阶段',
    cues: ['用髋铰链向后移动', '保持躯干刚性', '在可控拉伸范围内完成'],
    why: '3 组来自方法；10–12 次是 Pawside V1 当前的起始校准范围。',
    authority: 'mixed_with_product_default', media: media('romanian-deadlift', 'confirmed'),
  },
  {
    key: 'back_extension', splitKey: 'legs', order: 5, name: '山羊挺身', role: '后侧链',
    purpose: '竖脊肌与后侧链', prescription: '3 组 × 8 次',
    intensity: '前期不到力竭', progression: '当前只校准参考重量；长期递进仍待证据',
    cues: ['保持动作可控', '以后侧链完成伸展', '不靠惯性甩动'],
    why: '3×8 和前期不力竭均为方法明确内容；不虚构长期阶段。',
    authority: 'method_explicit', media: media('back-extension', 'confirmed'),
  },
]

const splitMeta: Record<MethodSplitKey, Omit<MethodSplit, 'key' | 'exercises'>> = {
  push: { day: 'Day 1', name: '推', focus: '胸 + 中束 + 三头' },
  pull: { day: 'Day 2', name: '拉', focus: '背 + 后束 + 二头' },
  legs: { day: 'Day 3', name: '腿', focus: '下肢后侧链优先' },
}

export const METHOD_SPLITS: MethodSplit[] = (['push', 'pull', 'legs'] as const).map((key) => ({
  key,
  ...splitMeta[key],
  exercises: exercises.filter((exercise) => exercise.splitKey === key),
}))

export function getMethodExercise(exerciseKey: string) {
  return exercises.find((exercise) => exercise.key === exerciseKey) ?? null
}

export function formatAuthority(authority: MethodAuthority) {
  return authority === 'method_explicit' ? '方法明确' : '含 Pawside V1 执行默认'
}
