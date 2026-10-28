# 方坤本轮修复交接（2026-10-28）

本轮是基于既有成果的修复交付，**不是54项总方案全部验收**。没有部署、合并、访问真实账号/生产数据库或调用付费模型。原始用户记录、私有V4与既有未提交文件保留；新用户不预装个人课表。

## 源码身份与提交范围

- 本轮基线：`8c1d4b694d2412d6f4c5dd513956f61cd9819716`。
- 本轮分支：`codex/coaching-repairs-20261028`，最终提交见 Git 分支及交付 receipt。
- 已通过 GitHub 连接器与 `git fetch origin master` 核实主线：`fb6d614bf2d0c196408055baa3a632d54951ac9d`。它与共同祖先 `de6bc5f` 的文件树相同，未发现需覆盖本地修复的新增主线文件变化。
- 远端此前没有 `8c1d4b6`；因此向主线的独立 PR 同时包含本地先前保存的 `149c11f`、`8c1d4b6` 成果。不要把整份 PR 差异都称为本轮新增。本轮单独差异以 `8c1d4b6..本轮提交` 为准。
- 保留原来两份未提交 `verification/implementation-20261028/personal/panel-fixture.*`，不混入本轮提交。预览日志、依赖和构建缓存不提交。

## 实际完成

| 项目 | 改变与证据 | 边界 |
|---|---|---|
| X01 时长/配速 | 明确活动身份去重，跑步分项与整课时间分开；同一活动6.01km的1611.94秒不再相加成3223.88秒 | 无明确身份不猜测合并；冲突或分项重叠未知不强行汇总 |
| X02 个人问题 | 口语复盘、隐含自述、朋友和本人混合句能选本人资料；一般知识不带旧选课 | 自然语言仍有边界，不声称任意句式理解 |
| X03 分析与对话 | 实际快照→SQL→控制器→假模型收到代码计算、版本、解释和有限对话；对话不能作为数字事实引用 | 客户端申报仍未独立核验；预算裁剪显式保留缺项 |
| X04 所选训练 | 比较入口的本地与联网均使用选定两节，40/50kg不混入未选90kg；更正45kg后旧回答过期 | 精确分项仍依赖原始来源/绑定；不是所有设备全量验真 |
| X05/X08 条件与限制 | 过期档案给条件性结论；疼痛不阻止无关营养或RPE知识；医疗/功能限制不解除 | 现有粗粒度反馈缺部位时仍需澄清；专业风险校准未完成 |
| X06 量化边界 | 复用既有计算和候选链，传递实际计算结果；确认前不写正式计划 | 不新增未经核验LT2配速或自动加量，任意剂量处方未实现 |
| X07 回答展示 | 跨句加粗先解析，内部字段转中文展示，原文可展开；联网回答接入同一组件；输入区与可滚动选项分离 | Chromium桌面/模拟手机，未测Safari真机和真实软键盘 |
| C01 分项经验 | 跑步与力量经验分别确认，已有可靠力量档案自动读取并保留来源 | 经验不冒充实测能力；未生成万能水平标签 |
| C03 历史 | 按问题读取本机保留的一年及更早历史，近期疲劳仍按原窗口处理 | 已被旧数量限制淘汰的记录不能凭空恢复 |
| J01 日期和更正 | 明天/后天/星期等进入现有确认流程；多个不同日期先澄清；更正投影同步教练、训练、健康 | 模糊反馈更正仍标未知，首次来源捕获失败的全量持久补审待补 |
| 额外发现 | 修复分析重算时间进入上下文标识，避免事实未变却自动取消联网请求 | 新事实、修订、实际候选/限制变化仍使旧依据失效 |

## 接口与证据映射

- `src/lib/ui/activity-dose.ts`：`activityDose(ActivityMember[])`，输出整课/跑步时间、跑步距离和冲突说明，只读。
- `src/lib/coach/online-context.ts`：`readOnlineContext`/`selectOnlineContext` 复用当前事实投影。上限32条、48KiB、引用提示预算4800字节；明确 omissions。
- `src/lib/coach/online-handoff.ts`：`localAnalysisRecords` 与 `dialogueRecords`；`ANALYSIS`/`DIALOGUE` 必须 `UNKNOWN + USER_DECLARED`，没有写入/医疗授权。
- `src/lib/coach/online-session.ts`、服务端 `coach-declarations.ts`、`coach-snapshot-store.server.ts`、`coach-chat.controller.js`：同一快照、来源版本、用户授权及输出引用校验。旧模型说过的数字不升级成事实。
- `src/lib/core/coach-import-evidence.ts`：`effectiveImportedTraining` 复用已有更正链，按原条目绑定；恢复模块、训练列表读取有效值，原导入不改写。
- `src/lib/coach/cycle/{types,portrait,planner}.ts` 与周期页面：分项经验及来源，沿用周期器、首周确认与计划版本。
- 本轮没有改动科学知识审批规则，不将研究组平均收益变成个人保证。知识与剂量专业审查仍见 `capability-gaps.md`。

## 贯通证据与候选

`verification/coaching-repairs-20261028/journey.json` 是实际代码执行的合成案例：一年历史→同日A/B选A→“明天呢”→保持原计划的预览→用户确认将强度课改轻松跑，既定力量不改→24h反馈→逐段39秒更正38.5秒→旧解释撤回、旧待确认候选失效、健康读取38.5秒。重复确认拒绝，切换运动员不读到A。没有通过合成文本导入声称真实手表接入。

`browser/result.json` 是真实浏览器→HTTP→签名合成身份→隔离PGlite→假模型的交互记录，含默认联网、并发两问、关闭持久化、疼痛与知识分别处理、周期/周复盘、明确比较和更正失效。假模型答案仅验证接线和防护，**不是DeepSeek能力证据**。

## 验证结果与失败账本

- 类型检查：`typecheck-delivery.exit`；前端/Node构建、开发/构建烟雾检查、Node真实路由：`runtime-results.json`。Node GET返回JSON禁用状态，POST禁用返回503，未出现静态HTML冒充API。
- 一次集中回归：`regression-results.json` 记录19组命令。初始环境spawnSync权限失败的5个脚本文件在获得本地执行权限后通过，见 `environment-script-tests.log`。
- 两处旧断言跟随本轮行为更新后局部通过：R189改为行为测试；更正cutoff测试分别验证旧时间点原值与当前更正值。见 `regression-fixed-cases.log`。
- 额外发现的5个基线既存失败仍保留：`training-redesign.test.tsx`、`warmup-workflow.test.tsx`、`character/integration.test.tsx`（旧文案/资源期待）；`coach-training-mechanisms.test.ts`（旧回答包装/规则期待）；`plan400-components-store.test.ts`（旧V4私有夹具期待）。同样5个文件在未修改8c1d4b6上失败，见 `extra-baseline.log` 与 `extra-diagnostic-*.log`。没有把全量回归写成全绿，也未为通过而恢复内置私人课表。
- 最后按变更影响范围执行 `final-affected.log`：线上事实/HTTP、回答UI、选择器、贯通更正及R189。时钟重算新增回归的修复前失败 `clock-before.log` 与修复后 `clock-after.log` 均保留。
- 浏览器初次误连旧后端、页面导航时机、折叠理由断言等失败保留。后续固定独立端口并要求当前测试进程仍存活，不复用旧后端。最新结果以 `browser/result.json` 和 `browser-current.exit`/最终runtime为准。
- 54项原状态保留在 `coverage-54.md` / `coverage-54.json`，本轮证据单列；不把文件数/断言数换成专业能力百分比。

## 部署、费用和回滚

没有本轮新增数据库迁移。既有服务端需要常驻Node、持久PostgreSQL、真实登录、三份coach迁移001/002/003、核验价格和预算；源码可构建不等于生产服务可用。不得仅设置环境开关就宣称数据库或费用已核验。

其他环境历史费用仍为 `UNKNOWN_PENDING_RECONCILIATION`；合成账本金额不是真实费用，也不表示历史费用为零。没有新增付费DeepSeek调用，不能报告其真实成功率。

开发安装遵循现有lockfile；启动用 `npm run dev`，类型检查 `npm run typecheck`，静态构建 `npm run build`，常驻后端构建 `npm run build:server`、运行 `.output/server/index.mjs`。这些是审阅者操作说明，不代表已部署。

回滚本轮：在独立分支执行 `git revert <本轮修复提交>`，保留用户存储和旧记录；不要reset/清空localStorage或删表。若仅更换发布源码，可回到 `8c1d4b6` 对照，**不要覆盖真实数据**。旧版不识别新增分析类别时须停用对应在线客户端并重新建立快照，不伪装兼容；没有生产数据库需要本轮回滚。

## 下一步

1. 对5个既存失败分别核对当前产品契约与合成夹具，不恢复任何个人模板。
2. 补全备份恢复跨旧标签隔离、首次来源捕获失败的持久补审和全部旧写入口治理；候选暂存不等于已安全恢复。
3. 补运动项目/协议可比性、长期反证、剂量与营养协同的专业案例；冻结原题集、真实答卷和失败不删。
4. 经用户另外批准后才安排真实登录/PostgreSQL/设备/Safari验证与有预算的模型抽样；不自动部署或付费调用。

完整源码按每ZIP小于15,000,000字节交付，含图片/动画/3D；不含.git历史、依赖/构建缓存、密钥和私有V4数据。所有ZIP解压到同一空目录，无需二进制拼接；每包哈希、源码清单、明确排除项见交付manifest。原始私有V4留在原工作区，不在新用户程序中预装。
