export const metadata = { title: '服务条款 · Pawside' }

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-6 text-gray-800">
      <h1 className="text-xl font-semibold">服务条款</h1>
      <p className="text-xs text-gray-400">更新日期：2026-10-06</p>
      <p>使用 Pawside 即表示你同意以下条款。目前应用处于内测阶段。</p>

      <h2 className="font-semibold">服务内容</h2>
      <p>Pawside 提供训练与饮食记录、训练计划参考，以及基于你记录的文字反馈。功能可能随内测调整。</p>

      <h2 className="font-semibold">使用须知</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>训练和饮食内容仅供参考，不是医疗建议。身体不适或有疾病史，请先咨询专业人士。</li>
        <li>请量力而行，训练安全由你自己负责。</li>
        <li>请妥善保管账号，不要用于违法用途。</li>
      </ul>

      <h2 className="font-semibold">第三方设备与服务</h2>
      <p>连接 Oura 等设备时，数据获取受对应服务商条款约束。你可以随时在应用内断开。</p>

      <h2 className="font-semibold">变更与联系</h2>
      <p>条款更新后会在本页公布。问题请联系 zichenwang209@gmail.com。</p>
    </main>
  )
}
