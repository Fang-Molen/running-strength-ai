# 1A 本地验证与修复状态

2026-10-28。基线：`92632540c8cd42267461d42403786bec2a2281eb`；工作分支 `codex/phased-plan-local-20261028`。本报告覆盖活动剂量、训练只读投影、现代分析/联网上下文/旧日汇总接线及其受影响测试。**状态：本地范围完成，1A 整体部分完成**，尚有下列真实环境与验收边界。

## 本次结果

复用原有 X01 修复：合成 A = 6.01 km、1611.94 秒，显示 `26:51.94`、`4'28"/km`，同源导入＋Garmin 视图只计算一次。原有 7 个 X01 用例保留通过。

本地修复及接线，均有修改前失败证据：

- `mergeActivities` 原先只合入首个共享身份组；第三来源明确桥接两组时仍剩两条。现在消费所有明确匹配组，保留每个原始成员，反复投影及输入顺序变化不再重复计时。
- 分圈更正后日志仍引用旧总量，而教练已经撤回旧总量。只读成员新增 `withdrawnMeasurements`，更正涉及的总时间/总距离标为未知，不从另一同源 Garmin 副本填回，也不把单段更正误当整课新总量。原始导入、手表缓存及同日 B 不变，分段更正仍按原有审计链读取。
- 新增 `readCurrentImportConflicts` 共享只读诊断：仅匹配当前用户当前 Garmin 视图中完全相同的活动来源身份，不使用同日/近似距离关联。`onlineTrainingFacts` 对冲突的总时间/总距离显示未知，保留可靠分段和未冲突字段；未知接收时间的缓存不替换历史事实、不输出缓存数值。冲突随当前缓存变化重新读取，未写入历史记录。
- 共享诊断现已接入 `recovery-host-u11`→`readAnalysis` 与 `readCoachData`，分别撤回冲突整课时间/距离及依赖它们的结束时刻/配速，保留可信分段和未冲突字段。原始 `knownAt/receivedAt` 不变，当前 `observedAt` 不进入历史事实；`readOnlineContext.coverage.unknowns` 与旧回答均显示“当前缓存冲突、录入时间未知、不作为历史事实”的限制。真实现代入口还发现分段更正后仍引用旧整课总量，现一并撤回，历史更正前 `asOf` 仍保留原总量。

| 验收项 | 本次结果 | 证据 |
| --- | --- | --- |
| 6.01 km / 26:51.94 多源去重 | 通过；周统计 A=27 分钟 | `1a-final-dose.log`、`1a-final-read-model.log` |
| 同账号重复保存幂等，同日 A/B 分离 | 通过；A+B=42 分钟、两条导入 | `1a-final-read-model.log` |
| 明确关联、解除关联 | 通过；仅选择 A，拒绝 A 后保留 B 候选，原始数据不变 | `1a-final-read-model.log` |
| 时长冲突与缺字段 | 日志/周统计、onlineTrainingFacts、现代分析及旧日汇总通过；冲突保留原始来源，相关总量未知；在线上下文保留限制且不发缓存冲突数值 | `1a-final-read-model.log`、`1a-entry-conflict-green.log` |
| 分圈时间/距离更正 | 通过；日志、周统计、现代分析和教练撤回旧总量，分圈保留新值；历史更正前数值不变 | `1a-final-read-model.log`、`1a-entry-conflict-green.log` |
| 重启/换人 | 通过序列化存储重挂载；换人后日志和教练排除原用户数据 | `1a-final-read-model.log` |

## 命令与结果

以下每个测试文件均以完整命令运行：

```sh
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs <测试文件>
```

不加载 `test-fixtures/private`；仅合成内存存储；禁止原生出站网络。直接执行测试文件使 Node 输出每个子测试的结果；`--test` 父进程模式在此预加载组合下只显示文件级计数，仍有真实失败退出码，因此本轮最终证据采用直接执行。

| 测试文件 | 通过/总数 | 退出码 | 证据前缀（均在 verification/phased-plan-20261028/） |
| --- | --- | --- | --- |
| `src/lib/ui/training-activity-dose.test.ts` | 8/8 | 0 | `1a-final-dose` |
| `src/lib/ui/training-read-model-1a.test.ts` | 4/4 | 0 | `1a-final-read-model` |
| `src/lib/ui/training-record-sync.test.ts` | 14/14 | 0 | `1a-regression-record-sync-final` |
| `src/lib/ui/run-link.test.ts` | 5/5 | 0 | `1a-regression-run-link` |
| `src/lib/coach/online-training-facts.test.ts` | 27/27 | 0 | `1a-conflict-green` |
| `src/lib/health/garmin-sync-runner.test.ts` | 21/21 | 0 | `1a-regression-garmin-sync` |

合计 79/79。本轮失败到通过证据：`1a-bridge-red-details`（7/8，退出1，2条≠1条）→`1a-bridge-green`（8/8，退出0）；`1a-correction-red`（3/4，退出1，1611.94≠null）→`1a-correction-green`（4/4，退出0）。冲突送模证据：`1a-conflict-red`（22/26，退出1，4个冲突用例失败）→`1a-conflict-green`（补充重载后27/27，退出0）。各前缀均有 `.log` 和 `.exit`。一次中途 bridge-green 调试出现 JSON 序列化丢弃 undefined 字段导致的测试比较差异；调整为序列化语义比较后覆盖了真实重载值，最终同名前缀为通过日志。

`git diff --check` 通过。`FK_NO_TEST_PLAN=1 npm run typecheck` 最终退出0，见 `1a-typecheck-final.log/.exit`。较早一轮退出2的 `1a-typecheck.log` 仅报其他分工进行中的 `food-capture` 模块缺失，现已解决；保留原证据。最终全仓构建和联调由主任务统一记录，本分工没有运行含数据库迁移的 `npm run build`。


### 现代与旧入口接线补充（同日）

新增 `src/lib/health/analysis-import-conflicts.test.ts`，直接调用保存入口、`readAnalysis`、`readOnlineContext`、`readCoachData` 及旧回答格式化入口。修改前 **1/7**，6 项功能失败（整课时长仍为 1800 秒、距离仍为 5.00 km 等），见 `1a-entry-conflict-red.log/.exit`；修改后 **7/7**，见 `1a-entry-conflict-green.log/.exit`。覆盖当前冲突、仅距离冲突、可信分段、历史 `asOf`/未来导入排除、来源完全相同身份、缺缓存字段、用户隔离、重载与清缓存、读操作不改原始存储，以及更正后整课总量撤回。

同样使用上述 `FK_NO_TEST_PLAN=1`、`no-network.mjs` 和 `test-register.mjs` 命令，补充回归如下：

| 测试文件 | 通过/总数 | 退出码 | 证据前缀 |
| --- | --- | --- | --- |
| `src/lib/health/analysis-import-conflicts.test.ts` | 7/7 | 0 | `1a-entry-conflict-green` |
| `src/lib/health/recovery-host-u11.test.ts` | 14/14 | 0 | `1a-entry-regression-recovery-host-u11` |
| `src/lib/health/recovery-host-u11-cutoff.test.ts` | 7/7 | 0 | `1a-entry-regression-recovery-host-u11-cutoff` |
| `src/lib/health/analysis-integration.test.ts` | 12/12 | 0 | `1a-entry-regression-analysis-integration` |
| `src/lib/health/analysis-dose-completeness.test.ts` | 4/4 | 0 | `1a-entry-regression-analysis-dose-completeness` |
| `src/lib/coach/online-context.test.ts` | 26/26 | 0 | `1a-entry-regression-online-context` |
| `src/lib/coach/online-training-facts.test.ts` | 27/27 | 0 | `1a-entry-regression-online-training-facts` |

接线补充批次 **97/97**；与上面的 79 项部分重复，不将两批简单相加为唯一测试数。证据均在 `verification/phased-plan-20261028/`，每个前缀均有 `.log/.exit`。接线后的 `FK_NO_TEST_PLAN=1 npm run typecheck` 退出0，见 `1a-entry-typecheck.log/.exit`；`git diff --check` 通过；全仓最终构建与浏览器验收仍由主任务统一记录。

## 未完成与实际限制

1. **当前缓存冲突仍是当前诊断，不是已知历史事件。** 共享 `readCurrentImportConflicts(records)` 保持 `cacheKnownAt:null`、`usableAsHistoricalEvidence:false`；现代/旧入口接线已经完成并有上述真实入口验证，但无法还原缓存何时首次发生冲突，不声称历史时点已知冲突，也不把当前缓存数值用作历史替代值。
2. 本轮“重启”是序列化存储后创建全新存储后端再读取，未证明设备进程崩溃、IndexedDB/原生物理后端或跨标签旧写者的恢复安全。
3. 同账号和换人覆盖为合成身份；真实 Garmin/其他品牌账户、设备/协议切换矩阵、iOS 真机、真实模型及专业有效性未验证。
4. 本分工未运行浏览器或拍摄 UI 截图；格式化函数及真实保存/读取入口已测试，视觉验收由主任务统一记录。
5. 正式备份恢复保持独立边界，本次没有恢复或覆盖任何真实用户数据；未推送、合并、部署、调用付费 API 或访问真实账号/生产库。

改动文件：`src/lib/ui/activity-dose.ts`、`src/lib/ui/training-read-model.ts`、`src/lib/ui/training-activity-dose.test.ts`、新增 `src/lib/ui/training-read-model-1a.test.ts`、`src/lib/core/current-import-conflicts.ts`，并修改 `src/lib/coach/online-training-facts.ts` 及其测试。接线补充修改 `src/lib/health/recovery-host-u11.ts`、`src/lib/health/coach-data.ts` 和 `src/lib/coach/online-context.ts` 的冲突 gap 透传，新增 `src/lib/health/analysis-import-conflicts.test.ts`；保留其他并行分工改动。未提交，由主任务整合。
