# 新手为什么坚持不下去：前 10 个原因，对照 Pawside（2026-11-09）

周计划 #30 周二的产品任务，提前到周一做。素材来自 `signals-data` 分支 11-07 到 11-09 三天的信号包（Reddit 公开帖，匿名引用，只摘原话片段）。这是方向性的定性信号，不是市场证明（见 `SIGNAL_METHOD.md` 第 6 节）。

「覆盖」只对照**已上线**的功能（`lib/site/features.ts` 里 `live` 的条目），规划中的功能不算。

| # | 原因 | 覆盖 | Pawside 现在有什么 / 缺什么 |
|---|---|---|---|
| 1 | 不知道从哪开始、练什么 | 已覆盖 | 选训练方法（三分化 / 四分化），之后「今天练什么」打开就有 |
| 2 | 去健身房紧张、怕被看、怕不会用器械 | 部分覆盖 | 每组说明、动作示意能减少「不会」；「被看」的不安没有处理，也不该由 App 处理 |
| 3 | 怕受伤、不确定动作对不对 | 部分覆盖 | 动作示意动画、每组说明；**缺**：没有「这一下疼该怎么办」的边界提示（只能引导就医，不能诊断） |
| 4 | 没有计划时就断掉 | 已覆盖 | 从上次停下的地方继续；本周训练 x/y 次，休息日不算失败 |
| 5 | 时间少，不确定少练有没有用 | 已覆盖 | 选今天有多少时间（30 / 45 / 60 / 90 分钟），动作数量跟着调 |
| 6 | 看不到变化，泄气 | 部分覆盖 | 训练记录、每周反馈；**缺**：「力量变化」的直观展示（同一动作重量 / 次数的走势） |
| 7 | 饮食太难：蛋白质吃不够、不知道吃多少 | 部分覆盖 | 每日饮食参考、手动记录、小爪一句话记；**缺**：吃不够蛋白的人怎么办的具体建议（见 #37） |
| 8 | 节食时饿、累、反复暴食 | 不做增长动作 | 风险信号（#29），只记不推。记录界面不评判「超了」，热量目标不低于安全下限 |
| 9 | 情绪低落、动力没了，回不到正轨 | 部分覆盖 | 休息日不算失败、不羞辱的反馈语气；**缺**：断了一阵后「回来第一天」的轻量版训练 |
| 10 | 天冷、天黑、生活忙，作息被打乱 | 缺口 | 没有「今天只能练 15 分钟 / 在家练」的选项；最短是 30 分钟、默认在健身房 |

## 原话证据（每条 ≥ 2）

1. **不知道从哪开始**
   - "I'm honestly clueless about where to start!"：[How to do body recomp](https://www.reddit.com/r/beginnerfitness/comments/1xqrlq6/how_to_do_body_recomp/)
   - "I dont have idea where to start"：[Looking for female gym buddy](https://www.reddit.com/r/beginnerfitness/comments/1xpwsq6/looking_for_female_gym_buddy_in_abu_dhabi/)
   - "I don't know how to stretch or what to even be doing when I get there"：[40M Looking for Guidance](https://www.reddit.com/r/beginnerfitness/comments/1xqxflm/40m_looking_for_guidance/)
2. **去健身房紧张**
   - "I don't go to the gym due to some anxiety… I don't know what I'm doing, and I hate running into people I know"：[Need a program to follow](https://www.reddit.com/r/beginnerfitness/comments/1xpny4l/need_a_program_to_follow/)
   - "I have always been scared of the gym but I was finally able to join a small gym last month"：[Any improvement?](https://www.reddit.com/r/beginnerfitness/comments/1xqr0ib/any_improvement/)
   - 跑步团里 "I was embarrassed"：[I joined a running club](https://www.reddit.com/r/loseit/comments/1xq0zpf/i_joined_a_running_club_for_the_first_time_i_was/)
3. **怕受伤**
   - "I'm extremely scared of injuring myself during gym"：[I'm scared of injuries](https://www.reddit.com/r/beginnerfitness/comments/1xqx76m/im_scared_of_injuries/)
   - 姿势问题能不能直接开始力量训练：[如果有人有姿势问题…](https://www.reddit.com/r/beginnerfitness/comments/1xqtwv3/如果有人有姿势问题是否真的不建议立即开始力量训练/)
   - 练了 6 周深蹲时手臂疼：[Bicep pain while barbell squatting](https://www.reddit.com/r/beginnerfitness/comments/1xqo9qa/bicep_painstrain_while_barbell_squatting_pain/)
4. **没有计划就断**
   - "When I didn't have a plan to follow, the consistency was worse so I always made sure to have one"：[Fitness industry is so focused on men](https://www.reddit.com/r/beginnerfitness/comments/1xqus1l/fitness_industry_is_so_focused_on_men/)
   - "right now I'd be happy to find a routine I can actually stick to"：[25f completely lost on how to be consistent](https://www.reddit.com/r/loseit/comments/1xq1tog/25f_completely_lose_on_how_to_be_consistent/)
5. **时间少**
   - "have been planning to go twice a week as that is about as much as I can fit in"：[will 2 days be enough](https://www.reddit.com/r/workout/comments/1xqto84/will_2_days_be_enough_to_see_any_gains/)
   - "Committing to come more than once a week is rough"：[Any improvement?](https://www.reddit.com/r/beginnerfitness/comments/1xqr0ib/any_improvement/)
6. **看不到变化**
   - "Is it normal to not see insane changes in the mirror after 6 months?"：[帖子](https://www.reddit.com/r/beginnerfitness/comments/1xqorcv/is_it_normal_to_not_see_insane_changes_in_the/)
   - 头 3 个月掉得慢 "really discouraging"：[thank you r/loseit](https://www.reddit.com/r/loseit/comments/1xr2xau/thank_you_rloseit_176_bodyweight911_body_fat_lost/)
   - "I'm feeling pretty discouraged"：[Advice needed](https://www.reddit.com/r/loseit/comments/1xq4o7e/advice_needed/)
7. **饮食太难**
   - "trying to fit in a high amount of protein feels overwhelming"：[Beginner struggling to get enough protein](https://www.reddit.com/r/beginnerfitness/comments/1xq1t1d/beginner_struggling_to_get_enough_protein_in/)
   - "I'm scared my diet will be too bad or I won't be able to eat enough"：[I'm stressing about diet](https://www.reddit.com/r/beginnerfitness/comments/1xqakna/im_stressing_about_diet_and_what_to_begin_with/)
8. **饿、累、暴食**（风险，只记录）
   - "I feel hungry and weak"：[Fatigue and hunger whilst in calorie deficit](https://www.reddit.com/r/loseit/comments/1xq8y9s/fatigue_and_hunger_whilst_in_calorie_deficit/)
   - 1200–1400 kcal "I always tend to overeat"：[5'0–5'2 what's your diet](https://www.reddit.com/r/loseit/comments/1xqxrvu/5052_or_152cm158cm_women_and_men_included_whats/)
   - 暴食后体重波动：[Weight fluctuations](https://www.reddit.com/r/loseit/comments/1xqy0in/weight_fluctuations/)
9. **动力没了、回不来**
   - "how people start… when they're in a depressive state and extremely unmotivated?"：[how to start](https://www.reddit.com/r/beginnerfitness/comments/1xqo0hp/how_to_start/)
   - 维持期休息后 "I've lost motivation to get back on track"：[I don't know how to get my motivation back](https://www.reddit.com/r/loseit/comments/1xqwtoz/i_dont_know_how_to_get_my_motivation_back/)
   - 反复节食 "never found anything that has stuck"：[HOW DID YOU KEEP IT OFF](https://www.reddit.com/r/loseit/comments/1xpt3ka/how_did_you_keep_it_off_a_tired_struggling_yoyo/)
10. **天冷天黑、生活忙**
    - "Getting dark at 4pm doesn't make things any better"：[How do you stay motivated in cold weather?](https://www.reddit.com/r/workout/comments/1xqbbra/how_do_you_stay_motivated_in_cold_weather/)
    - 离开健身房一年后在家练 "I don't have a place to dedicate to training"：[How do you stay focused during a workout (from home)](https://www.reddit.com/r/workout/comments/1xqy3bq/how_do_you_stay_focused_during_a_workout_from_home/)
    - 出差多，作息乱了就断："getting out of my routine due to traveling a lot"：[Fitness industry is so focused on men](https://www.reddit.com/r/beginnerfitness/comments/1xqus1l/fitness_industry_is_so_focused_on_men/)

## 缺口里值得做的（按可做程度排，进「待评估」，不在本周开工）

1. **短时间 / 在家版本**（第 10 条，部分第 5、9 条）：「今天只有 15 分钟」或「今天在家」。服务留存，证据 3 条。
2. **断了之后回来的第一天**（第 9 条）：间隔久了，自动给一个轻一点的回归日，不提「你断了 N 天」。
3. **力量变化走势**（第 6 条）：同一动作的重量 / 次数随时间的变化。数据已有，只差展示。
4. **蛋白质吃不够的具体办法**（第 7 条）：和 #37 合并。

不做的：第 2 条（社交焦虑）、第 8 条（进食问题）只记风险，不做增长动作；第 3 条只做「引导就医」的边界，不做诊断。
