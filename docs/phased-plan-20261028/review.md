# 2026-10-28 独立最终代码审查

审查基线：`92632540c8cd42267461d42403786bec2a2281eb`；审查对象为共享工作区未提交改动。重点为第 1A–1C、1E 批及第 2/3 批已有边界。1D 正在由另一代理收尾，未对该批作完整验收。没有运行付费调用、真实账号、生产数据库、迁移、部署或推送。

## 发现

未发现 Critical；以下 Important 已通过合成输入复现并即时通知主代理。

### R1：未来跳过状态绕过周期反馈截止时间

- 位置：`src/lib/coach/cycle/host.ts:207`。
- 触发：冻结 `asOf=2026-11-01T10:00:00Z`，候选课程原为 `planned`；随后保存 `status=skipped`、`actual.outcome=missed`、`actual.at=2026-11-02T10:00:00Z`。
- 实际：历史结果从 `PENDING / missed=0` 变成 `WEAKENED / missed=1`，反馈版本 `basis` 也改变。新增 `actuals` 时间过滤被当前 `status==='skipped'` 分支绕过。
- 最小修复：漏练只由截止前可见的 actual 判断；缺少可靠记录时间的 legacy skipped 保留未知。增加 status 与 actual 同时变化、legacy skipped 无时间的回归。
- 状态：已修复；新回归先失败后通过，验证结果见下方。

### R2：明确年份检索仍受 90 天读取窗口截断

- 位置：`src/lib/coach/online-context.ts:76`、`:264`；对应新增选择器 `src/lib/coach/context-period.ts`。
- 触发：合成保存本人 `2025-01-15` 的已确认导入，以 `day=2026-10-28` 调用真实 `readOnlineContext`。
- 实际：问“复盘我去年的训练”选到该记录；问等价的“复盘我2025年的训练”得到空结果。`contextPeriod` 识别年份，但 `needs.historical` 未识别 `2025年`，上游只读最近 90 天；`前年`、单独 `今年` 同有窗口不一致风险。
- 最小修复：用同一个日历期间解析决定 RETAINED 读取与后续筛选；补真实存储入口的显式年份与相对年份成对测试。
- 状态：主代理已修复，统一日历期间识别决定历史读取。真实存储入口覆盖去年/2025年、前年/2024年、今年及双年份/明确日期；review-history-red.exit=1 → review-history-green.exit=0（1个子测试、6种日期表达），旧实现显式年份为空，新实现选择正确年份。

### R3：选中导入的旧教练入口仍引用冲突整课时长

- 位置：`src/lib/core/coach-import-evidence.ts:140`；实际调用入口 `src/lib/core/coach-brief.ts:186`。
- 触发：已确认导入整课 1800 秒，当前缓存相同 `sourceIdentity` 为 1900 秒。
- 实际：`readCurrentImportConflicts(coachImports()).size===1`，但 `importedCoachParts(record, '复盘').durationSec===1800`。现代分析和每日旧上下文已经撤回该总量，明确选中的导入入口仍把旧总量传入 `deriveCoachBrief`。逐段 duration 更正后同一字段也仍引用旧总量。
- 最小修复：该入口复用当前冲突诊断与可见更正边界，撤回受影响的整课 duration，并传递冲突/更正说明；保留可靠分段和原始来源。
- 状态：经主代理追加授权，已修复该函数；新回归先失败后通过，验证结果见下方。

## 本轮未发现重要问题的范围

- 当前缓存冲突不替换历史数值；缓存无可靠录入时间被明确披露。现代分析、每日旧上下文、在线训练事实对冲突整课总量的撤回及来源身份隔离通过现有回归。
- 普通知识和第三人单独问题不附带本人事实；明确训练选择与日期筛选已有合成隔离回归。R2 是真实读取窗口与纯选择器之间的遗漏。
- 长限制文本拆段、超限标记、服务端合并与 REVIEW_PENDING 回退未发现解除限制的可复现问题。
- 预算裁剪后针对仍保留分析的 evidenceVersion 检查，以及旧基线/反证优先级通过现有目标回归；未将此结论扩展为真实模型质量或费用验证。
- 比较＋改课调用仍只生成 R5 预览；未发现自动提交正式课表的路径。
- 恢复事务写入前增加身份/隔离复查，失败恢复仍读取持久日志；现有合成恢复测试通过。真实跨标签旧写者隔离和正式恢复不在本轮验证范围。

## 执行证据

审查阶段运行，退出码 0：

```sh
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs --test --test-concurrency=3 src/lib/coach/online-context.test.ts src/lib/coach/online-training-facts.test.ts src/lib/health/analysis-import-conflicts.test.ts src/lib/core/restore-transaction.test.ts src/lib/coach/cycle/feedback-cutoff.test.ts src/lib/ui/training-read-model-1a.test.ts
```

结果为 6 个测试文件通过。上述通过不覆盖三个遗漏；R1–R3 均另外使用合成内存存储/固定时间输入复现。全站、真实设备、专业教练意见与真实模型未在本审查中验收。

### R1 / R3 修复验证

先运行新增行为回归，观察到对应失败：R1 两项为 `WEAKENED !== PENDING`；R3 两项为 `1800 !== null`，另有距离冲突说明缺失。随后才修改生产代码。

以下两次直接运行测试文件均退出 0，分别为 5/5、3/3 个用例通过：

```sh
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs src/lib/coach/cycle/feedback-cutoff.test.ts
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs src/lib/core/coach-import-totals.test.ts
```

关联回归退出 0，以下 6 个文件全部通过：

```sh
FK_NO_TEST_PLAN=1 node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs --test --test-concurrency=3 src/lib/coach/cycle/host.test.ts src/lib/core/coach-r10-regression.test.ts src/lib/core/coach-r11-integrity.test.ts src/lib/core/coach-r11-mixed-session.test.ts src/lib/health/analysis-import-conflicts.test.ts src/lib/ui/pet-capture.test.ts
```

生产改动仅涉及 `cycle/host.ts` 漏练计数及 `coach-import-evidence.ts` 的选中导入整课时长/说明；新增 `coach-import-totals.test.ts` 并扩充 `feedback-cutoff.test.ts`。没有提交或覆盖其他代理修改。本审查未运行完整 npm test、类型检查或构建；主代理负责整批最终门槛。
