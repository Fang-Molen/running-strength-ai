# FRAME-10 田径逐段日志纠错 — 开发报告

状态：IMPLEMENTED / UNVERIFIED，不可发布。

## 修改
- 新增 `src/lib/core/running-log-correction.ts`：使用现有 `fr255-training-correction-v1` 追加式纠错存储，按唯一 `sourceEventIds[0]` 绑定距离或用时，要求正数与原因。
- 日志 `training-log-panel.tsx`：展示每段原始/有效距离与时间，提供「修改本段成绩」弹窗；重复或无来源的段不提供修改。
- 新增 `running-log-correction.test.ts`，涵盖重复修改、原始事件不变、歧义来源拒绝。
- 原有 AI Brain、Decision、running-execution 和事件数据均未改动。

## 重要限制
- 纠错仅作用于日志展示，不影响原始训练事实、训练决策、统计或能力推断；暂不支持纠正休息时间、训练结束事件。
- 目前没有对不同 trainingOccurrenceId 的跑步和力量执行跨训练关联；不能按日期自动合并。
- 没有覆盖线上试用版或清空本地数据。

## 验证
- 新增测试尝试使用 `node --experimental-strip-types --test` 执行，因现有项目依赖 `@/lib` 路径别名、当前无 node_modules，测试在模块加载阶段失败；**不是测试 PASS**。
- TypeScript、生产构建、全量测试和手机浏览器均未完成验证。

## 后续
- 优先恢复 npm 依赖/tsx 测试环境并完整验证。
- 在统一训练身份合同下实现同次跑步+力量正式结束、反馈、修正休息和可确认的历史关联。
