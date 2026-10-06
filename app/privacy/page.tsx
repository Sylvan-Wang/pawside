export const metadata = { title: '隐私政策 · Pawside' }

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8 text-sm leading-6 text-gray-800">
      <h1 className="text-xl font-semibold">隐私政策</h1>
      <p className="text-xs text-gray-400">更新日期：2026-10-06</p>
      <p>Pawside 是一个健身与饮食记录应用。下面说明我们收集哪些数据、怎么用、怎么删除。</p>

      <h2 className="font-semibold">我们收集的数据</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>账号信息：邮箱。</li>
        <li>你主动记录的内容：训练、饮食、身体数据、主观恢复自评。</li>
        <li>
          你主动连接的运动健康设备数据（目前是 Oura）：每日睡眠、准备度、活动和运动摘要。只有你在设置页授权后才会读取，随时可以断开。
        </li>
      </ul>

      <h2 className="font-semibold">怎么使用</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>用于在应用里展示你的记录，并生成训练、饮食和每日复盘的文字反馈。</li>
        <li>生成反馈时，相关的记录摘要会发送给我们使用的 AI 服务商处理，不包含你的邮箱。</li>
        <li>我们不出售你的数据，也不用于广告。</li>
      </ul>

      <h2 className="font-semibold">存储与安全</h2>
      <p>数据存放在 Supabase 托管的数据库中，按账号隔离。设备授权凭证加密保存。</p>

      <h2 className="font-semibold">你的选择</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>在「我的 → 运动健康设备」断开后，我们不再读取该设备的新数据，并可删除已同步的数据。</li>
        <li>需要导出或删除账号及全部数据，请联系 zhenyuca@usc.edu。</li>
      </ul>

      <h2 className="font-semibold">非医疗声明</h2>
      <p>Pawside 提供的是记录和训练参考，不构成医疗建议或诊断。</p>
    </main>
  )
}
