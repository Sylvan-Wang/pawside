# 食谱推荐：上线与运营手册

状态：代码已完成，**数据库迁移和种子还没在线上执行，也没有任何食谱被发布**，所以用户现在看不到任何推荐。

## 它是什么

`public.recipes` 存「别人视频的指针」：标题、B 站链接、几个标签。不存视频、不存封面。
小爪在用户问「想吃什么 / 推荐点吃的」（模型判为 `consult_food`）时，由**服务端**从表里挑最多 3 个已发布的食谱，把标题和链接拼进回复。模型不参与选择、不写链接、不写数字。

- 只有 `status = 'published'` 且用户有 `recipes` 功能位的行才读得到（行级权限，见迁移）。
- `published` 必须有 `verified_at`（数据库约束）：发布前要有人看过。
- 热量只显示成「视频标称」，永不参与计算，不会记进用户的饮食。整天热量、口径不明的数字不显示。
- 蛋白质/碳水/脂肪列保持空，没有可信来源就不填，也不让模型猜。
- 总开关：Netlify 环境变量 `PAWSIDE_COACH_RECIPES=0` 立即停掉推荐。

## 上线步骤（按顺序，在 Supabase SQL Editor）

1. 执行 `supabase/migrations/20261023000300_recipes.sql`（新表 + 功能位 `recipes`，默认关）。
2. 执行 `supabase/seeds/recipes_draft_seed.sql`（128 条，全部 `draft`；可重复执行，不会改状态）。
3. 核验若干条（打开链接，确认标题对、是食谱），然后发布：
   ```sql
   update public.recipes
   set status = 'published', verified_at = now(), published_at = now(), up_verified = true
   where recipe_code in ('RCP-0001', 'RCP-0002');
   ```
   `up_verified` 只在你确认了这条确实是你要推荐的那位 UP 主时才设为 true。
4. 先只给自己开：
   ```sql
   insert into public.user_features (user_id, feature_key) values ('<你的用户id>', 'recipes');
   ```
   自己试几天后，对所有人开：
   ```sql
   update public.app_features set enabled_for_all = true, updated_at = now() where key = 'recipes';
   ```
5. 官网：有已发布食谱并对用户开放后，再在 `lib/site/features.ts` 加一条「食谱推荐」并设为 `live`（现在没有，因为没有任何可推荐的内容）。

## 下线 / 撤回一条

```sql
update public.recipes set status = 'retired' where recipe_code = 'RCP-0001';
```

## 数据质量（导入时的状态）

全部 128 条来源是「二手 AI 整理，未独立核验」。已知问题：只有 29 条有热量数字，热量口径几乎都是 `unspecified`；UP 主名字有 6 种写法，部分是 AI 写出来的；有 4 条标了 BV 号映射多个标题。所以导入全是 `draft`，必须先核验再发布。

## 小爪怎么选

- 有话题（如「三文鱼」）：只返回标题/食材/索引文本里包含话题词的已发布食谱，没有就不推荐，不会拿无关的凑数。
- 没话题（如「今天吃什么」）：从已发布里挑 3 个，同一天结果稳定，隔天轮换。
