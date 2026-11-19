// 动作英文名。动作名来自数据库 exercises.canonical_name_zh，线上 53 个动作的 canonical_name_en 全空
// （2026-11-16 只读查询）。按 docs/i18n/batch1-strings.md 第 4 节，先放代码字典：不动线上数据，随时可撤；
// 英文模式下查不到就显示中文原名。以后要回填 canonical_name_en（改线上数据）先问 xxa。
// key 必须和数据库里的中文名逐字一致（2026-11-19 对过 53 / 53）。
import type { Locale } from './index'

export const EXERCISE_NAMES_EN: Record<string, string> = {
  'Y 字侧平举': 'Y-Raise',
  '上斜哑铃卧推': 'Incline Dumbbell Bench Press',
  '下斜器械卧推': 'Decline Machine Chest Press',
  '仰卧杠铃臂屈伸': 'Lying Barbell Triceps Extension',
  '侧卧抬腿': 'Side-Lying Leg Raise',
  '侧平举': 'Lateral Raise',
  '保加利亚分腿蹲': 'Bulgarian Split Squat',
  '俯卧W抬臂': 'Prone W Raise',
  '俯卧反向雪天使': 'Prone Reverse Snow Angel',
  '俯身反向平举': 'Bent-Over Reverse Fly',
  '前平举': 'Front Raise',
  '前蹲/颈前深蹲': 'Front Squat',
  '单手器械划船': 'Single-Arm Machine Row',
  '单手绳索下拉': 'Single-Arm Cable Pulldown',
  '单腿硬拉': 'Single-Leg Deadlift',
  '卷腹': 'Crunch',
  '双杠臂屈伸': 'Parallel Bar Dip',
  '反向卷腹': 'Reverse Crunch',
  '哑铃分腿蹲': 'Dumbbell Split Squat',
  '哑铃平板卧推': 'Dumbbell Bench Press',
  '哑铃提踵': 'Dumbbell Calf Raise',
  '哑铃罗马尼亚硬拉': 'Dumbbell Romanian Deadlift',
  '哑铃肩推': 'Dumbbell Shoulder Press',
  '器械髋内收': 'Machine Hip Adduction',
  '器械髋外展': 'Machine Hip Abduction',
  '坐姿器械划船': 'Seated Machine Row',
  '坐姿开肘划船': 'Seated Wide-Elbow Row',
  '坐姿肩屈位绳索弯举': 'Seated Cable Curl (Shoulder Flexed)',
  '墙面俯卧撑': 'Wall Push-Up',
  '对握高位下拉': 'Neutral-Grip Lat Pulldown',
  '山羊挺身': 'Back Extension',
  '平板支撑': 'Plank',
  '徒手分腿蹲': 'Bodyweight Split Squat',
  '徒手提踵': 'Bodyweight Calf Raise',
  '徒手深蹲': 'Bodyweight Squat',
  '悬垂举腿': 'Hanging Leg Raise',
  '支撑单臂哑铃划船': 'Supported Single-Arm Dumbbell Row',
  '杠铃卧推': 'Barbell Bench Press',
  '杠铃深蹲': 'Barbell Back Squat',
  '杯式深蹲': 'Goblet Squat',
  '死虫式': 'Dead Bug',
  '硬拉': 'Deadlift',
  '窄距俯卧撑': 'Close-Grip Push-Up',
  '绳索交叉夹胸': 'Cable Crossover',
  '罗马尼亚硬拉': 'Romanian Deadlift',
  '罗马椅挺身': 'Roman Chair Back Extension',
  '臀桥': 'Glute Bridge',
  '跑步机慢跑': 'Treadmill Jog',
  '跪姿俯卧撑': 'Kneeling Push-Up',
  '轻松踏步有氧': 'Easy Step Cardio',
  '面拉': 'Face Pull',
  '高位下拉': 'Lat Pulldown',
  '鸟狗式': 'Bird Dog',
}

/** 中文模式原样返回；英文模式查字典，查不到就用中文原名（不猜、不机翻）。 */
export function exerciseDisplayName(nameZh: string, locale: Locale = 'zh'): string {
  if (locale !== 'en') return nameZh
  return EXERCISE_NAMES_EN[nameZh] ?? nameZh
}
