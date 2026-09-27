import PageHeader from '@/components/PageHeader'
import {
  WORKOUT_GUIDE_ATTRIBUTION_TEXT,
  WORKOUT_GUIDE_GENERAL_SOURCE_URL,
  WORKOUT_GUIDE_LICENSE_URL,
} from '@/lib/exercise-media'
import packageJson from '@/package.json'

const APP_VERSION = packageJson.version

/**
 * Patch B · B2: the fixed captions this replaces (per-clip attribution,
 * "方法明确 / 运行时默认" badges, the settings-page AI line, "3 个关键帧")
 * were meaningless to a user in place; this page is where that provenance
 * actually belongs, stated once.
 */
export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      <PageHeader title="关于" back />
      <main className="space-y-4 px-4 py-5">
        <section className="rounded-2xl bg-white p-4">
          <p className="text-lg font-semibold text-gray-900">Pawside</p>
          <p className="mt-1 text-xs text-gray-400">版本 {APP_VERSION}</p>
        </section>

        <section className="rounded-2xl bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">训练方法</h2>
          <p className="mt-2 text-sm leading-6 text-gray-700">
            训练方法来自「凯圣王 × 谭成义 2026 三分化」。
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">动作素材</h2>
          <p className="mt-2 text-sm leading-6 text-gray-700">{WORKOUT_GUIDE_ATTRIBUTION_TEXT}</p>
          <p className="mt-2 text-xs leading-5 text-gray-500">
            <a className="underline" href={WORKOUT_GUIDE_LICENSE_URL} target="_blank" rel="noreferrer">
              CC BY-SA 4.0 许可证
            </a>
            {' · '}
            <a className="underline" href={WORKOUT_GUIDE_GENERAL_SOURCE_URL} target="_blank" rel="noreferrer">
              素材来源
            </a>
          </p>
        </section>

        <section className="rounded-2xl bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">AI 服务</h2>
          <p className="mt-2 text-sm leading-6 text-gray-700">
            训练反馈、饮食反馈和每日复盘由 AI 生成。
          </p>
        </section>
      </main>
    </div>
  )
}
