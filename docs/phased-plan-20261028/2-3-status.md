# 第 2、3 批本地能力与验证状态

日期：2026-10-28。按当前源码及本轮新运行结果记录；本页是第 2、3 批局部交付，不表示整批专业能力或正式恢复已经验收。与第一批及总交接一起阅读。

## 范围与数据保护

- 工作区 `/workspace/fangkun-20261028`，本地分支 `codex/phased-plan-local-20261028`。保留其他代理与用户已有改动；本分工无提交、推送、合并或部署。
- 只使用内存、临时目录和合成档案，测试均设置 `FK_NO_TEST_PLAN=1`；没有恢复内置私人 V4 计划，没有访问真实账号、生产数据库或付费 API。
- 使用 `athlete-fatigue-recovery`、`athlete-periodization-review` 的证据/时序/修订边界，并按 systematic-debugging、test-driven-development、verification-before-completion 执行局部反例和回归。没有新增训练剂量、医学阈值或科学有效性宣称。
- 最终相关回归同时覆盖实际宿主服务和 React 服务端渲染测试；它们不是浏览器交互、真实设备或真人训练效果验收。本分工未启动构建；整合后的类型、构建和浏览器结果由总交接记录。

## 本轮两处局部修复

### L01 恢复事务异步边界重新核对身份与写者隔离

根因：`restore-transaction.ts` 原先在 `await isolation()` 前核对身份，写入意图持久化后及回退读取后，未再次核对。这些等待期间切人或失去隔离，可以继续写入物理目标；回退甚至可能报告完成。

修复：隔离检查返回后再次核对身份；正式写入前与回退写入前重新执行身份/隔离检查。条件不成立则保留持久意图与原值，进入 `NOT_STARTED` 或 `RECOVERY_REQUIRED`；不能冒报成功。

证据：新增四个反例，覆盖等待隔离时切人、保存写入意图时切人、保存意图时失去隔离、回退读取时切人。旧实现 4 失败，修复后恢复事务 13/13 通过，并保留写入失败回退、提交确认丢失、重启恢复、独立后续修改不能被回退覆盖等既有测试。

责任文件：`src/lib/core/restore-transaction.ts`、`src/lib/core/restore-transaction.test.ts`。

**边界：** 事务引擎仍要求宿主真正维持物理写者隔离，重复布尔检查不构成锁。没有将该引擎接入网页正式恢复；跨旧版本标签和真实后端崩溃隔离仍未验收。

### L02 周期反馈统一遵守分析截止时间

根因：`assessCycleFeedback` 对完成/少练已有截止检查，对漏练、疼痛/高 RPE 反证、未记录数与反馈摘要仍读取当前存储的全部 `actual`。后来才录入或时间无效的反馈，可以提前改变较早日期的结论。

修复：以 `actual.at <= asOf` 建立本次可用反馈集合，完成、漏练、少练、反证、未记录数与反馈版本使用同一集合；截止之后和无效时间的 `actual` 保持未知，到达录入时间后才影响复盘。不更改正式课表、原记录或旧草案。

证据：三项纯函数反例旧实现全部失败，修复后 3/3 通过；另补真实宿主链路 `prepareCycle → decideCycle(ACCEPT) → saveSchedule(actual) → refreshCycleFeedback(较早/较晚截止)`，验证旧截止待观察、新截止计入漏练、日历保持原样，宿主文件 15/15 通过。

责任文件：`src/lib/coach/cycle/host.ts`、`src/lib/coach/cycle/feedback-cutoff.test.ts`、`src/lib/coach/cycle/host.test.ts`。

**边界：** 这是实际反馈时间的一致性修复。当前日历仍是当前文档，`status=skipped` 没有独立发生/录入时间，不能据此声称已实现任意历史日历状态的双时间回放。

## 第 2 批逐项盘点

| 能力 | 当前源码与本轮证据 | 状态与剩余工作 |
|---|---|---|
| 跑步分项及 8/12/24/52 周 | `cycle/planner.ts`、`types.ts`、`portrait.ts`、`CoachCyclePanel` 已有专项目的/证据需求、分项经验、条件阶段和最近一周确认；`event-selection`、`stage-evidence`、`request`、`cycle` 测试覆盖 400/800/1500/3000/5000/10000、其他长距离、近期实记、可用天数/时间、器械、比赛变化、疼痛优先和不补叠历史。 | 部分实现，本地回归通过。专项标签、已有课选择与阶段条件不证明每项剂量适配；长期计划仍需新反馈逐周确认，专业剂量复核与真实效果未验。 |
| 力量与跑力统筹 | `cycle/actual-structure.ts`、`actual-seeds.ts`、`planner.ts` 与 R4/R5 复用逐组、动作、休息、设备和实际课程；`adaptive-import`、`adaptive`、`review-findings` 覆盖器械不足、不同协议、重复反馈、熟悉课程、单变量候选。 | 部分实现；未创建新力量系统。动作教学/生物力学、剂量和个体进阶仍须专业验证，不把合成正反馈当作加量许可。 |
| 饮食覆盖与消耗 | `analysis-nutrition-boundary.test.ts`、`r4/answer.test.ts`、`r4/assessment.test.ts` 在本轮通过：训练能耗不可冒充全天总消耗，餐记录/缺营养素不变成已知零；营养更正改变回答版本。 | 本分工只复核既有只读边界，未改饮食记录。真实食物源、份量准确性、个体营养方案和跨域全流程由对应交付/后续验证承担。 |
| 恢复与个人参考 | `health/analysis-host.ts`、`recovery-assessment.ts`、`recovery-quantitative.ts`、`recovery-host-u11.ts`、`recovery-history.ts`；本轮覆盖同源/同协议、设备切换、未来/外人/撤销证据、缺睡眠/HRV、疼痛独立限制、跑力参与、跨午夜睡眠保留区间与更正投影。 | 本地边界通过、专业未验。历史中位数/趋势是描述方法；不是冻结的生理基线、组织恢复百分比或复训许可。 |
| 长期画像和改判 | `coach/assessment/history.ts`、`cycle/portrait.ts`、`core/coach-p7-runtime.ts`；`correction-recovery`、`analysis-integration`、`history`、`portrait-evidence` 证明来源更正/撤销/不可读/冲突引起旧结论失效，不靠恢复事实复活旧解释；审计写失败后重启与补审有合成证据。 | 部分实现。本轮新增 L02 使未来实际反馈不能提前影响旧复盘；尚无长期真人预测误差、因果作用或个体效果证据。 |
| 中控确认、回执和撤销 | R4 `course-flow`、R5 `host/weekly-host`、cycle `host` 与两个面板测试通过。预览不写，确认校验当前版本；按回执防重复；切人拒绝；后来改课、开始执行或健康更正阻止破坏性撤销；无关课程/外人数据保留。 | 已有局部真实宿主入口证据；不表示所有模块写入口和所有浏览器并发情形穷尽验证。 |
| 知识来源和专业审查 | `r4/reference.ts` 读取带版本的知识卡与来源；返回 `REFERENCE_SELECTION_ONLY`、`applicability=NOT_ESTABLISHED`、`prescriptionApproved=false`；来源完整性和错误人群/缺字段排除测试通过。 | 参考检索已接入；未做本轮一手研究系统综述或独立专家签审，不能称专业认证。 |

需要独立专业复核的具体既有规则：`src/lib/ui/day-schedule-rules.ts` 仍有统一每周强度次数、固定间隔、设备准备度/HRV提示及基于完成次数的进阶经验规则。`rule-ledger.json` 已将工程资格、产品描述和专业未校准分开，但不能据此认定这些旧路径都已专项化。本分工记录范围，不另设新的处方阈值。

## 第 3 批逐项盘点

| 能力 | 当前源码与本轮证据 | 状态与下一项验证 |
|---|---|---|
| 安全候选与禁止直接覆盖 | `settings-center.tsx → prepareAnyBackup/stagePreparedBackup → stageRestoreCandidate`；`backup-candidate`、`restore-candidate`、`vault-backup`、`vault-migration`、`backup-center` 在本轮通过：原值/目标预检、身份与预检变化、读回校验、独立候选库、原记录不改、不可报告正式恢复。浏览器/物理适配器的旧同步 restore/undo 被拒。 | 候选保存已实现且本地验证。网页仍不能证明旧标签停止写入，正式恢复未启用；这是保留的保护条件。 |
| 正式恢复事务 | `restore-transaction.ts` 已有逐后端原值、校验、持久阶段/意图、提交结果不明时限制、重启读取权威日志、条件回退与独立修改冲突保护。本轮修复 L01。 | 仅引擎合成验证；未证明跨旧版本写者隔离，未做真实物理后端/跨标签崩溃恢复。不能称正式恢复通过。 |
| 外部品牌、账号、iPhone/iPad、模型、食物源、SQL 与费用 | 未使用真实账号、设备、模型、数据库或食物服务。代码中的支持项与模拟测试只能说明接线/字段边界。 | 外部未验；需要分别提供可用且获授权的测试环境、每个品牌字段/身份/失败场景、真机系统版本和回执。费用未知，未作零费用结论。 |
| 冻结题集与长期验证 | 本轮使用既有公开合成测试与新增开发反例；未把新增反例标为独立盲测或未见测试集。 | 专业及长期效果未验；需独立冻结问题/反例、明确人群和终点、真实后续记录与专家审阅，报告分母/误差/失败。无准确率或效果声明。 |

## 能力/数据不足表

| 具体问题 | 已读取的资料与能确认部分 | 缺口类别 | 最少下一步 | 责任文件 |
|---|---|---|---|---|
| 旧日期周期结论是否用了未来反馈 | 当前日历 actual 录入时刻及指定 asOf；L02 已拒绝未来/无效时间实际反馈。 | 未采集：跳过状态的独立历史时间；知识/规则不足：完整历史日历投影 | 为需要历史回放的状态定义可追溯时间和版本，先明确兼容旧数据的未知行为。 | `cycle/host.ts`、`ui/day-schedule-rules.ts` |
| 400 米和长跑是否真正量身定制 | 本轮读取专项选择、经验与阶段源码，合成对照可区分项目和限制。 | 专业未验 | 专家逐项核对现有候选剂量/专项迁移和旧排期规则；随后用真人执行验证。 | `cycle/planner.ts`、`ui/day-schedule-rules.ts` |
| 本人是否恢复/能否加量 | 同协议历史、实际训练、反馈、疼痛和限制能形成描述与候选。 | 未采集/外部未验/专业未验，按具体用户资料分别列 | 补最相关的当前功能/主观状态/实际执行，不强制固定天数，也不把单 HRV 当作决定。 | `health/recovery-assessment.ts`、`health/recovery-quantitative.ts` |
| 是否可以正式恢复备份 | 候选副本可验证；事务引擎有持久日志和故障注入证据。 | 外部未验：写者隔离与物理后端 | 在可证明独占旧/新写者的专用宿主完成故障恢复矩阵，保留原值；网页继续仅候选。 | `core/restore-transaction.ts`、`core/restore-candidate.ts`、`ui/backup-center.ts` |
| 知识能否当专业结论 | 可追溯卡片、来源、版本、缺项与人群边界。 | 专业未验 | 当前一手来源逐条核对并由适当专业人员独立审阅。 | `coach/r4/reference.ts`、`knowledge/professional-r4-20261024/` |

## 本轮运行证据

日志均在 `verification/phased-plan-20261028/`。环境实际 Node `v24.19.0`。`node --test` 的本环境输出按测试文件汇总，下表 54 等数字是文件数，不能写成 54 个断言或 54 项专业能力。

| 日志 | 运行结果 | 退出码 |
|---|---|---|
| `later-restore-red.log` | 恢复事务：9 通过、4 新反例失败，确认旧实现缺陷 | 1 |
| `later-restore-green.log` | 修复后事务 13/13 用例通过 | 0 |
| `later-feedback-red.log` | 3 个截止时间反例均失败 | 1 |
| `later-feedback-green.log` | 修复后 3/3 用例通过 | 0 |
| `later-feedback-host.log` | 周期真实宿主服务 15/15 用例通过，含新增截止反馈链 | 0 |
| `later-regression.log` | 首轮相关回归 46/46 文件通过，发生在 L02 修复前 | 0 |
| `later-cycle-final.log` | L02 修复后周期/画像/两个面板 15/15 文件通过 | 0 |
| `later-final-regression.log` | 所有本分工修改后，恢复/备份/更正/分析/R4/R5/周期/面板 54/54 文件通过 | 0 |

定向命令（分别在对应 RED/GREEN 源码状态运行；恢复 RED 的有效直接运行未加载网络拦截，但模块无网络调用；所有 GREEN 与最终回归加载拦截）：

```bash
FK_NO_TEST_PLAN=1 node --import ./scripts/test-register.mjs src/lib/core/restore-transaction.test.ts
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs src/lib/core/restore-transaction.test.ts
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs src/lib/coach/cycle/feedback-cutoff.test.ts
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs src/lib/coach/cycle/host.test.ts
```

最终相关回归完整命令：

```bash
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs --test --test-concurrency=3 src/lib/core/restore-candidate.test.ts src/lib/core/restore-transaction.test.ts src/lib/core/storage-journal.test.ts src/lib/core/backup-archive.test.ts src/lib/vault-backup.test.ts src/lib/vault-migration.test.ts src/lib/ui/backup-candidate.test.ts src/lib/ui/backup-center.test.ts src/lib/core/correction-recovery.test.ts src/lib/health/reviewed-correction.test.ts src/lib/health/recovery-*.test.ts src/lib/health/multi-device-recovery-v92.test.ts src/lib/health/intraday-recovery-bridge-v89.test.ts src/lib/health/analysis-*.test.ts src/lib/coach/r4/*.test.ts src/lib/coach/r5/*.test.ts src/lib/coach/cycle/*.test.ts src/lib/coach/assessment/*.test.ts src/components/coach-cycle-panel.test.tsx src/components/coach-plan-change-panel.test.tsx
```

## 五个历史基线失败的本轮复现与分类

五文件均在新设备模式独立运行，命令为 `FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs <文件>`。各退出码 1；调度收集器退出 0 只表示日志收集完成，不表示测试通过。结果见 `later-baseline-five-results.json` 与下列日志。

| 文件/日志 | 通过/失败用例 | 本轮观察与处置 |
|---|---:|---|
| `training-redesign.test.tsx` / `later-baseline-training-redesign.test.tsx.log` | 3/1 | 身体目标测试首先失败于旧精确文案 `角色外观参考图（非3D）`。未改变断言或组件；需按现有视觉方案核对行为与措辞，不能仅凭分类宣布无缺陷。 |
| `warmup-workflow.test.tsx` / `later-baseline-warmup-workflow.test.tsx.log` | 3/1 | 男性参考图测试仍期待 `male-front.webp`，与现有参考资源不一致；女性和未审批热身相关用例通过。未改断言、资源。 |
| `character/integration.test.tsx` / `later-baseline-integration.test.tsx.log` | 4/2 | 动作计数展示期待 `找到 100 个动作`；缺视频回退期待通用 `female-front.webp`，当前输出动作姿势示意且标待审核。需对照最新资源/视觉要求评审，未为通过恢复旧图。 |
| `coach-training-mechanisms.test.ts` / `later-baseline-coach-training-mechanisms.test.ts.log` | 9/5 | 四个一般知识回答和 400 米比较首先失败于 `^结论：` 固定包装。400 米旧测试另含乳酸/比赛配速/全力测试等后续断言，尚不能把所有后续科学预期当成有效要求；未改为迎合测试的处方，需专业复核。 |
| `plan400-components-store.test.ts` / `later-baseline-plan400-components-store.test.ts.log` | 2/3 | 计划日志/关联用例假定特定 V4 课表存在；`FK_NO_TEST_PLAN=1` 下无该课表，实际缺少预期行和关联。最小合法修复方向是测试显式建立公开合成计划并验证行为；本分工未改此面、不恢复私人夹具。 |

对应原 54 项，本页新增局部证据主要影响 B02/B03/B04/B05/B06、C02/C03/C04、G01–G04、H01–H05、I02/I04、J01–J03、K02–K04；未将这些整项升级为全完成。旧失败仍保留，完整网站、真机、正式恢复、真实模型和专业长期效果均未由本页验收。
