import type { Metadata } from 'next'
import Link from 'next/link'
import PageHeader from '@/components/PageHeader'

export const metadata: Metadata = {
  title: '隐私政策 · 爪边',
  description: '爪边如何收集、使用和保存你的训练、饮食与身体数据',
}

const UPDATED_AT = '2026 年 10 月 6 日'
const CONTACT_EMAIL = 'refrigerium@qq.com'

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

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <PageHeader title="隐私政策" />

      <div className="px-4 py-4 space-y-4">
        <Link href="/" className="inline-block text-xs text-gray-400 underline">← 返回爪边</Link>
        <div className="bg-white rounded-2xl p-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            本政策说明爪边收集哪些信息、用来做什么，以及你可以怎样查看、更正或删除它们。
          </p>
          <p className="text-xs text-gray-400 mt-3">
            更新日期：{UPDATED_AT}
          </p>
        </div>

        <Section
          title="一、我们收集什么"
          paragraphs={[
            '我们只收集提供训练和饮食记录功能所需要的信息。具体是下面这些。',
          ]}
          bullets={[
            '账号：邮箱地址，以及用于登录的加密凭证。',
            '身体与目标：性别、身高、体重、目标（减脂、增肌或保持）、每周训练目标次数、每日热量目标、体重单位偏好。',
            '训练记录：每组的重量、次数和时长，有氧运动的距离，以及你写的训练笔记。',
            '饮食记录：食物名称、份量、热量，以及属于哪一餐。',
            '身体指标：体重、体脂率和围度。',
            '主观自评：睡眠质量和训练后恢复，各 1 到 5 分。',
            '对 AI 反馈的评价：你标记的「有帮助」或「没帮助」。',
          ]}
        />

        <Section
          title="二、我们不收集什么"
          paragraphs={[
            '我们不收集你的位置、通讯录、照片或支付信息。',
            '应用内没有广告，也没有第三方统计脚本。',
            '如果你以后连接了智能戒指，那部分数据由你在设备厂商那边授权后才会读取，范围见第五节。',
          ]}
        />

        <Section
          title="三、这些信息用来做什么"
          bullets={[
            '生成训练后、餐后、日度和周度的文字反馈。',
            '在你的记录页展示你自己的数据。',
            '保存你的资料和目标，让下次打开时不用重填。',
            '排查故障和回答你的问题。',
          ]}
        />

        <Section
          title="四、AI 是怎么工作的"
          paragraphs={[
            '生成文字反馈时，我们把你当天的训练、饮食和身体数据整理成一份摘要，连同你的目标一起发给 OpenAI，由它生成回复。',
            '摘要里包含你记录的食物名、动作名和训练笔记。这些内容会离开爪边，发送到 OpenAI 位于美国的服务器。',
            '我们不在摘要里加入你的邮箱地址。',
            '我们不会把你的记录用于训练模型。关于 OpenAI 账户层面的模型训练设置，我们正在确认，确认后会在这里写明。',
            '生成的文字是训练和饮食方面的参考，不是医疗判断。',
          ]}
        />

        <Section
          title="五、连接 Oura 后会读取什么"
          paragraphs={[
            '目前爪边还没有开放 Oura 连接，下面写的是开放之后的做法。',
            '连接 Oura 是可选的。只有你在应用里主动授权之后，我们才会读取。',
            '我们申请的读取范围只有每日摘要：睡眠、准备度和活动。我们不读取你的年龄、性别、身高、体重，也不读取运动明细。',
            '这些数据只用来在应用里向你展示趋势。我们不会把 Oura 的数据发给 OpenAI 或任何 AI 模型，也不会用它生成文字反馈、训练建议或休息建议。',
            'Oura 是独立的公司和数据来源。爪边不依赖它运行：不连接 Oura，训练和饮食记录功能仍然可用。',
            '如果你断开连接，我们会删除已经从 Oura 同步过来的数据。断开功能目前还在开发中，现在请发邮件给我们处理。',
          ]}
        />

        <Section
          title="六、谁会接触到你的数据"
          bullets={[
            'Supabase：托管我们的数据库和登录系统，保存上面列出的全部内容。',
            'Netlify：托管网站和静态文件，会记录访问日志和 IP 地址。',
            'OpenAI：生成文字反馈，处理我们发给它的数据摘要。',
            'Oura：你授权连接后，按你的授权范围提供睡眠、准备度、活动和运动数据。',
          ]}
        />

        <Section
          title="七、数据存放在哪里"
          paragraphs={[
            '数据库、OpenAI 和 Oura 都在中国境外。你的训练、饮食和身体数据会离开你所在的国家和地区。',
            '如果你的所在地区有跨境数据传输的规则，我们会按该规则处理，例如在发送前先征求你的单独同意。',
          ]}
        />

        <Section
          title="八、我们保存多久"
          paragraphs={[
            '账号存在期间，我们会一直保留你的数据。',
            '生成文字反馈时，会保存一份生成记录，用来排查问题和改进产品。这份记录里的内容会定期清理；清理机制的具体安排我们还在确认，所以这里暂时不写具体天数。',
            '你删除账号或断开 Oura 后，我们会删除对应的数据。',
          ]}
        />

        <Section
          title="九、你能做什么"
          bullets={[
            '查看和导出：在设置页可以导出训练、饮食、身体数据和周度总结，格式是 CSV。目前导出的范围还不完整，不包含训练执行细节、睡眠与恢复自评、AI 反馈和你的资料。需要完整数据时，请发邮件给我们。',
            '更正：资料和目标可以在设置页里改。更早的训练记录能否修改，我们还在确认；如果你需要改，请发邮件。',
            '删除账号：目前还没有自助删除入口。请发邮件到 ' + CONTACT_EMAIL + '，我们会帮你删除。',
            '断开 Oura：请发邮件给我们，我们会删除已同步的 Oura 数据。',
            '撤回同意：你随时可以撤回对本应用的同意，方式是发邮件给我们。撤回之后，我们会停止收集和使用你的数据。',
            '投诉：你有权向所在地区的数据保护监管机构投诉。',
          ]}
        />

        <Section
          title="十、未成年人"
          paragraphs={[
            '本应用面向成年人。如果你未满 16 岁，请不要注册或使用。',
            '如果你未满 16 岁却已经注册了，请发邮件告诉我们，我们会删除你的账号和数据。',
          ]}
        />

        <Section
          title="十一、安全"
          paragraphs={[
            '我们用行业通行的方式保护数据，包括登录鉴权、传输加密和访问控制。',
            '但没有任何一种传输方式可以保证绝对安全。如果你发现安全问题，请尽快发邮件告诉我们。',
          ]}
        />

        <Section
          title="十二、第三方服务的条款"
          paragraphs={[
            'Oura、OpenAI、Supabase 和 Netlify 都有自己的服务条款和隐私政策。使用爪边的同时，你也在使用这些服务，受它们的条款约束。',
            '爪边与 Oura 没有官方合作关系，不使用 Oura 的标识。',
          ]}
        />

        <Section
          title="十三、本政策的更新"
          paragraphs={[
            '政策变化时我们会更新本页面，并把新的更新日期写在顶部。',
            '涉及收集范围、用途或共享对象的重要变化，我们会另外向你说明。',
          ]}
        />

        <Section
          title="十四、联系我们"
          paragraphs={[
            '关于本政策或你的数据有任何问题，请发邮件到 ' + CONTACT_EMAIL + '。',
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