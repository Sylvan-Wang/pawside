# Oura 接入：设置与上线步骤（内部）

状态：代码已完成（分支未合并前不可用）。**只对被授权的内测用户开放**（功能开关 `oura_beta`）。

## 它做什么
- 用户在「设置 → 运动健康设备」点「连接 Oura」，授权后我们每次读取最近 30 天的每日睡眠、准备度、活动摘要（睡眠分、准备度分、活动分、步数、活动消耗），存进 `device_daily_metrics`，在该页面画趋势。
- **只展示，不进 AI。** Oura 协议禁止把 Oura 数据交给 AI 模型。`tests/devices/no-ai.test.ts` 会拦住任何 AI 文件引用设备数据。准备度分数也只是展示，不触发任何建议。
- 只申请 `daily` 一个权限。令牌用 AES-256-GCM 加密后存库（`device_connections`），客户端角色读不到。
- 断开连接 = 立即删除凭据和已同步的数据。删除账号会级联清除。

## 上线前要做的事（按顺序）
1. 在 Oura 开发者后台注册应用（见下面「表单怎么填」），拿到 Client ID 和 Client Secret。
2. Netlify 环境变量（仅服务端，不要加 `NEXT_PUBLIC_`）：
   - `OURA_CLIENT_ID`、`OURA_CLIENT_SECRET`
   - `DEVICE_TOKEN_ENCRYPTION_KEY`：在终端运行 `openssl rand -base64 32` 生成。**换掉它会让已存的令牌失效**，用户需要重新连接。
   - （`SUPABASE_SERVICE_ROLE_KEY` 已配）
   - 保存后重新部署。
3. 在线上库执行迁移 `supabase/migrations/20261007000200_device_integrations.sql`。
4. 给那位内测用户开通功能（把邮箱换成他注册 Pawside 用的邮箱）：
   ```sql
   insert into public.user_features (user_id, feature_key)
   select id, 'oura_beta' from auth.users where email = '用户的邮箱'
   on conflict do nothing;
   ```
   收回时：`delete from public.user_features where feature_key = 'oura_beta' and user_id = (select id from auth.users where email = '用户的邮箱');`
5. 让他登录 → 设置 → 运动健康设备 → 连接 Oura → 在 Oura 页面授权 → 回到爪边，应看到最近的睡眠和准备度。

## Oura 表单怎么填
| 字段 | 填写 |
|---|---|
| Display Name | `爪边 Pawside` |
| Description | `Pawside is a fitness logging app. With the user's consent it reads daily sleep, readiness and activity summaries and shows them as trends on the user's own settings page. Read-only. The data is never used to train or prompt any AI model, and it is deleted when the user disconnects.` |
| Contact Email | `refrigerium@qq.com` |
| Website | `https://paw-side.com/welcome` |
| Privacy Policy | `https://paw-side.com/privacy` |
| Terms of Service | `https://paw-side.com/terms` |
| Redirect URIs | `https://paw-side.com/api/devices/oura/callback`（必须一字不差，不要结尾斜杠；预览站的地址不能用，OAuth 只在正式域名上工作） |
| Scopes | **只勾 Daily**。取消：Email、Personal、Heartrate、Tag、Workout、Session、SpO2、Ring Configuration、Stress、Heart Health |

## 排错
- 点「连接」后回到设置页提示「暂时无法连接」：三个环境变量缺一个，或功能开关没给这个用户。
- 授权后提示「连接没成功」：Redirect URI 与后台登记的不一致，或回调时登录状态丢了（用同一个浏览器完成）。
- 页面提示「授权已失效，请重新连接」：Oura 拒绝了刷新令牌（用户在 Oura 里撤销过，或令牌过期）。点「重新连接」。
