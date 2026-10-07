@AGENTS.md

## Coach AI 工作（2026-09-27 起）

做任何 AI 反馈、prompt、训练或饮食规则相关的工作之前，先读 @docs/coach/HANDOFF.md，并照它第 0 节列出的顺序读完其余文档。

## 官网同步（2026-10-06 起）

官网（`app/welcome/`、`components/site/`）展示的功能状态，统一由 `lib/site/features.ts` 管理（已上线 / 内测中 / 规划中）。联系邮箱和 FAQ 在 `lib/site/content.ts`。

**任何改动用户可见功能的工作，完成时必须同时：**

1. 更新 `lib/site/features.ts` 里对应功能的状态（新功能先加一条；做完 / 上线后把 `planned` 改成 `live`；「内测中」只用于内测用户今天就能用到的功能）。
2. 检查官网文案是否还准确（首页、方法页、路线图、FAQ、手机框里的演示界面）。界面改了，`components/site/screens.tsx` 里的演示界面也要跟着改。
3. 跑 `npx vitest run tests/site`。它会拦住官网上不该出现的说法。

写官网和对外文案之前，先读 `docs/marketing/MESSAGE_HOUSE.md`（内部文档，不对外）。对外不写还没实现的功能当作已有；愿景可以写，但必须带「规划中」角标。

## 设备数据（Oura）规则（2026-10-07 起）

Oura 的 API 协议禁止把 Oura 数据或其衍生数据交给任何 AI 模型。所以设备数据**只展示给本人看**：

- 设备相关代码在 `lib/devices/`、`app/api/devices/`、`components/devices/`、`app/settings/devices/`。
- **任何 AI 相关文件都不能引用它们**（`lib/ai*`、`lib/evidence`、`lib/coach`、`lib/nutrition`、`app/api/ai`）。`tests/devices/no-ai.test.ts` 会逐个扫描，失败时不要改测试，要去掉依赖，或先拿到 Oura 的书面同意。
- 只申请 `daily` 一个权限范围。令牌用 AES-256-GCM 加密后存库，客户端角色读不到；断开连接要立即删除凭据和已同步的数据。
- 官网不提 Oura（`tests/site` 会拦）；官网只写「更多设备接入：规划中」。
