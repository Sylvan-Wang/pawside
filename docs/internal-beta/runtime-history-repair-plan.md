# 历史训练误推进诊断与受控修复方案

## 当前结论

当前源码可确认的缺陷是旧完成函数只要求至少一组已保存，然后把其余动作标为 skipped 并推进训练序列。当前 GET 查看链路未发现写操作，因此“查看即推进”的具体历史原因仍需数据库证据确认。

## 第一阶段：只读诊断

以单个用户或单个 Session 为范围导出以下证据，不执行更新：

1. workout_sessions 的 started_at、completed_at、status、completion_rule_version。
2. 每个 exercise_execution 是否至少存在一组 completed set。
3. 对应 session_prescription、method_cycle 与 method_enrollment 的当前状态。
4. 该 Session 之后是否已经存在真实完成的后续训练、历史日志或新的 Cycle。

候选误推进定义：completion_rule_version 为空，Session 为 completed，且至少一个处方动作没有 completed set。候选仅表示“需要复核”，不能直接等同于误推进。

## 第二阶段：生成单条修复计划

修复工具必须接收明确的 session_id，并先返回 dry-run：预计回退的 Session、处方、Cycle 指针和 Enrollment 指针，以及所有下游依赖。存在任一后续真实完成 Session 时自动 HOLD，不允许覆盖。

## 第三阶段：人工确认后事务修复

仅在 dry-run 无冲突且人工确认后，对单个 session_id 在一个数据库事务内执行；事务结束前重新检查锁定行与下游依赖。任何不一致都回滚。禁止按用户、日期或状态做批量 UPDATE。

## 回滚与证据

修复前保存受影响行快照和操作者、原因、时间；修复事件写入追加式审计表。修复后重新运行状态一致性检查。当前提交只包含诊断标准与方案，不执行任何历史数据修改。
