import type { Metadata } from 'next'
import PageHeader from '@/components/PageHeader'

export const metadata: Metadata = {
  title: '服务条款 · 爪边',
  description: '使用爪边前你需要知道的规则和边界',
}

const UPDATED_AT = '2026 年 10 月 6 日'
const CONTACT_EMAIL = 'zichenwang209@gmail.com'

function Section({
  title,
  paragraphs,
  bullets,
}: {
  title: string
  paragraphs?: string[]
  bullets?: string[]
}) {
  return (
    <section className="bg-white rounded-2xl p-4">
      <p className="text-sm font-semibold mb-3">{title}</p>
      <div className="space-y-3">
        {paragraphs?.map((text) => (
          <p key={text} className="text-sm text-gray-700 leading-relaxed">
            {text}
          </p>
        ))}
        {bullets && (
          <ul className="space-y-2">
            {bullets.map((item) => (
              <li key={item} className="text-sm text-gray-700 leading-relaxed">
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <PageHeader title="服务条款" />

      <div className="px-4 py-4 space-y-4">
        <div className="bg-white rounded-2xl p-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            本条款是你和爪边之间关于使用本应用的全部约定。注册或继续使用，即表示你同意本条款。
          </p>
          <p className="text-xs text-gray-400 mt-3">
            更新日期：{UPDATED_AT}
          </p>
        </div>

        <Section
          title="一、这不是医疗建议"
          paragraphs={[
            '爪边是健身和饮食记录工具，不是医疗器械，也不是医疗服务。',
            '应用里的文字反馈是对你自己数据的整理和参考，不构成诊断、治疗方案或专业建议。',
            '有健康问题、受伤疑虑或需要营养处方时，请咨询医生或注册营养师。',
            '孕期、产后、有慢性疾病、正在服药，或正在调整用药时，先问医生，再参考应用里的建议。',
          ]}
        />

        <Section
          title="二、AI 反馈的局限"
          paragraphs={[
            '文字反馈由 AI 生成，它会出错，也可能因为数据不全而误判。',
            '生成内容只基于你输入的数据。缺失的记录不会被自动补上，也不会被推测。',
            '请把它当作参考，不要当作权威结论。你的判断优先于应用里的建议。',
          ]}
        />

        <Section
          title="三、训练安全由你自己负责"
          paragraphs={[
            '开始新的训练方式、大幅增加重量或改变饮食前，请先评估自己的身体状况。',
            '训练中如果感到疼痛、头晕或不适，请立即停止。',
            '因为照着应用里的建议训练而产生的伤害，责任由你自己承担。',
          ]}
        />

        <Section
          title="四、目前是内测阶段"
          paragraphs={[
            '应用现在处于内测，只有少量用户在用。',
            '功能会变，界面会改，数据结构会调整。',
            '服务可能中断，也可能长时间不可用。我们不承诺任何可用性。',
            '重要数据请自己留一份备份，不要只存在这里。',
          ]}
        />

        <Section
          title="五、你的账号"
          paragraphs={[
            '一个人只能开一个账号。请用你自己的邮箱注册。',
            '账号的登录凭证由你保管。别人用了你的账号，责任由你承担。',
            '发现账号被盗或有人在未经你同意的情况下使用它，请立刻发邮件告诉我们。',
            '你可以随时要求删除账号。目前需要发邮件到 ' + CONTACT_EMAIL + '。',
          ]}
        />

        <Section
          title="六、你写的内容"
          paragraphs={[
            '你记录的训练、饮食和身体数据，以及你写的笔记，仍然是你的。',
            '为了生成文字反馈，我们会把这些内容整理成摘要发给 OpenAI 处理。',
            '你同意我们为了提供和改进服务而使用你写的内容。',
          ]}
        />

        <Section
          title="七、第三方设备和服务"
          paragraphs={[
            '如果你连接 Oura，你从 Oura 读到的数据受 Oura 自己的条款和隐私政策约束。',
            'Oura 对数据的准确性、完整性和可用性负责，我们不对它的数据做担保。',
            '爪边与 Oura 没有官方合作关系，不使用 Oura 的标识。',
            '你可以随时断开连接，断开后我们不再读取 Oura 数据，并删除已同步的部分。',
          ]}
        />

        <Section
          title="八、你可以做的事和不可以做的事"
          paragraphs={[
            '你可以正常记录数据、导出自己的数据、要求删除数据。',
            '你不能试图破坏或入侵服务，不能反过来用本应用收集他人的信息，也不能用本应用做违法的事。',
          ]}
        />

        <Section
          title="九、我们不保证什么"
          paragraphs={[
            '应用按现状提供。我们尽力保证它能用，但不保证它一定不中断、没有错误，或适合你的具体目标。',
            '我们不因为使用本应用产生的训练结果、身体变化或任何间接后果承担责任。',
          ]}
        />

        <Section
          title="十、我们可以改什么、什么时候停用"
          paragraphs={[
            '我们可以随时修改或暂停这些条款，也会随时调整功能。条款变化时，我们会更新本页面并写上新的更新日期。',
            '如果严重违反这些条款，我们可以暂停或关闭你的账号。',
          ]}
        />

        <Section
          title="十一、适用法律和争议解决"
          paragraphs={[
            '本条款适用哪一地的法律、争议在哪里解决，我们还在确定，确定后会在这里写明。',
            '在确定之前，如果你对条款有疑问，请发邮件告诉我们。',
          ]}
        />

        <Section
          title="十二、未成年人"
          paragraphs={[
            '本应用面向成年人。如果你未满 16 岁，请不要注册或使用。',
          ]}
        />

        <Section
          title="十三、联系我们"
          paragraphs={[
            '关于本条款的任何问题，请发邮件到 ' + CONTACT_EMAIL + '。',
          ]}
        />

        <div className="px-1 pt-1 pb-2">
          <p className="text-xs text-gray-400 leading-relaxed">
            更新日期：{UPDATED_AT}
          </p>
        </div>
      </div>
    </div>
  )
}