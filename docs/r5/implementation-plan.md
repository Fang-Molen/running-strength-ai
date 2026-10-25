# R5 综合能力升级实施计划

**目标：** 在最新 master 06539ca 上接通对话确认写入、疼痛追踪、周复盘与下周草案。用户已明确要求集中实施、末尾完整回归；按此授权直接执行。

**架构：** 复用 effective-profile、BODY_MEASUREMENT_RECORDED、analysis snapshot/response、安全评估、日历写入锁和撤销回执。R5 只增加意图、流程和周汇总，不建立第二个疲劳引擎。React 保留现有界面结构，新增确认卡与健康症状面板。

**技术：** TypeScript、React、Node test、现有 Vite/TanStack。

## 固定约束
- 独立分支 codex/r5-integrated-coach-20261025；PR 交付；不合并、不部署、不调用付费模型。
- 1000 字上限；最多两个关键追问；未知保持 null；不以计划推定实际。
- 所有执行先确认、复核最新依据及归属，幂等；撤销不得覆盖后来修改和已开始训练。
- 原 UI、V4、手表接口、原始计划与历史原样保留；新增审计，不清缓存。
- 无后台任务时周日或下次打开补生成；不宣称后台运行。

## 风险输入与验证重点
同日重复体重/历史更正；同日组合课；确认期间资料或训练版本变化；多个设备协议不一致；账号切换与未归属旧数据；部分饮食和部分训练；疼痛零值不能释放既有限制；重复确认与撤销后旧结论修订。

## 任务 1：对话确认写入
文件：src/lib/coach/r5/{contracts,intents,commands,host}.ts、src/components/coach-r5-panel.tsx；修改 coach-sheet、effective-host/profile、day-schedule。
接口：prepareR5Command(question, now) -> 持久化预览；decideR5Command(id, action) -> 显式确认/拒绝/撤销结果。
- [x] 先写真实宿主测试：66kg 更正前后、目标/历史区分、周四改课、组合课保留、减少一组、过期/并发/重复/撤销。
- [x] 看失败后实现；复用身体测量事件和原日历锁；变更与回执同一份日历文档提交。
- [x] 局部验证并提交。

## 任务 2：症状追踪与统一安全链
文件：src/lib/health/symptom-{store,review}.ts、src/components/symptom-panel.tsx；修改 analysis-host、health-subscription、body-center。
接口：appendSymptom(input)、readSymptoms(asOf)、reviewSymptoms(rows, day, span)；响应投影进入原安全评估。
- [x] 先写测试：左右/疼痛酸痛分离、3/7/14天、加重/功能受限、设备正常不解除、修订/撤回。
- [x] 看失败后实现，保留持续时间、诱因、功能和训练依据；禁止诊断与恢复百分比。
- [x] 局部验证并提交。

## 任务 3：周复盘与下周草案
文件：src/lib/coach/r5/{weekly,weekly-host}.ts、src/components/coach-weekly-panel.tsx。
接口：buildWeeklyReview(input)、generateWeeklyDraft(now)、confirmWeeklyDraft(id)、undoWeeklyDraft(id)。
- [x] 先写测试：实际跑步/力量分别统计、漏练与未记区分、来源分组的恢复趋势、饮食仅记录小计、拒绝及结果、历史更正使复盘失效。
- [x] 草案使用已保存课程/既有安排；无历史不能编造剂量；总时长/跑量/组数/强度逐项不增加；安全限制、比赛和相邻强度保护；无可靠剂量时只给待补充草案。
- [x] 周日和重新打开时幂等补生成；正式日历仅在确认后写入。

## 任务 4：接线、核验与交付
- [x] 修复 R4 跑步/力量候选并集；统一资料扩展来源与冲突；预留比赛、测量、营养合同。
- [x] 联网和离线复用现有事实核验，新增安全约束不能被模型解除；无模型实跑。
- [x] 必要局部测试后，最后统一 npm test、npm run typecheck、npm run build；记录所有失败，不引用旧通过数。
- [x] 使用合成数据验证真实页面，保存确认卡、健康趋势、周复盘截图；五组前后案例与日志。
- [x] 一次独立代码审查；PR 汇总、完整源码 GitHub 快照、增量补丁、回滚与未完成项。

结果与未通过项见 verification.md；完整回归已执行但仍有基线/环境失败，勾选表示步骤已执行，不代表全部通过。
