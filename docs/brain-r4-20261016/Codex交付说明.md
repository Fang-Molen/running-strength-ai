# 方坤 R4 P0 交付说明 · 2026-10-16

仅处理疲劳规则冲突、力量减组异常、跨课记录混合和教练建议验证失真。基于已交付的 UI 精修源码，在独立副本合入候选修复，并修复本地新增检查发现的5处边界问题。没有修改 UI、人物、饮食、已有用户记录，也没有部署。

当前结论：**LOCAL_AUTOMATED_REGRESSION_PASS**。本结论只覆盖以下实际执行的自动化检查；供 Grok 独立复测，不代表整套教练科学准确率或真实模型能力得到验证。

## 四项实际结果

| 项目 | PASS | FAIL | 行为 |
| --- | ---: | ---: | --- |
| P0-01 | 3 | 0 | 低分不再等于READY；比赛/减量周限制优先；疼痛康复限制保留 |
| P0-02 | 2 | 0 | 仅定位目标动作；一组不增组；多动作缺ID或重复ID不执行 |
| P0-03 | 8 | 0 | 按当前运动员、session与有效occurrence隔离；完成事件不串课；旧模糊记录降级 |
| P0-04 | 2 | 0 | 完成仅属遵从度；无事前验证任务时success=null、NOT_TESTABLE；保留旧记录 |

原源码以真实依赖直接执行附件7例，结果为 **0 PASS / 7 FAIL**；原候选补丁为 **7 PASS / 0 FAIL**。新增边界检查后候选为 **10 PASS / 5 FAIL**。最终定向 **15 PASS / 0 FAIL**。旧的READY断言按新合同改为CAUTION，未删除或降低安全断言。

新增5处修复：低分CAUTION不能提前绕过比赛/减量限制；切回运动员不能取其他人的最新组；空occurrence不能当稳定身份；未绑定组不能借用绑定旧课的RPE；完成记录的幂等查询与occurrence选择须限定当前运动员。仅补同一训练判断文件中的逻辑，不另建大脑。

## 执行记录

标准入口加补充回归合计 **3297 PASS / 0 FAIL / 0 SKIP**。这是实际运行的测试实例数；单独复跑的15例不重复计入合计。

| 命令/阶段 | 状态 | PASS / FAIL / SKIP | 原始日志 |
| --- | --- | --- | --- |
| 16-typecheck-final | PASS | 0 / 0 / 0 | 16-typecheck-final.log |
| 17-build-final | PASS | 0 / 0 / 0 | 17-build-final.log |
| 14-extra-regression-final | PASS | 1003 / 0 / 0 | 14-extra-regression-final.log |
| 15-p0-final-ipc | PASS | 15 / 0 / 0 | 15-p0-final-ipc.log |
| 19-npm-test-recheck | PASS | 2294 / 0 / 0 | 19-npm-test-recheck.log |

类型检查与构建行的0/0/0表示不是测试用例，是否通过看退出码与状态。`npm test`与补充回归分别统计，不把重复的15例定向检查再次计入全量合计。补充回归列出的74个文件是原npm入口遗漏的现有测试；源码中共有218个自动测试文件，范围明细见`regression-scope-final.json`。日志中的自定义核查输出与Node测试用例计数分开保留。

首次可正常通信的完整回归又发现旧测试加载器不支持CSS导入，导致hydration.test.tsx无法执行。补上仅测试用途的CSS加载处理后，单独复验并重新执行npm test；保留13-npm-test-final.log中的原始失败。

最初受限沙箱的Node子进程通信出现EPERM，导致4个脚本文件失败且部分嵌套输出不可见。用输出探针确认后启用本地子进程所需权限，重新执行未改断言的回归。早期日志原样保留，但不作为最终验收结论，也不记作已修复的产品缺陷。详情见`environment-issue.json`。

依赖复用当前完整安装，并核对 TypeScript、Zod、React、ReactDOM、MiniSearch 与锁文件一致；没有使用附件中的占位包，也没有改依赖版本。未重新执行`npm ci`。构建在无DATABASE_URL的环境按原脚本跳过数据库迁移。

## 改动范围和数据保留

- `src/lib/core/training-decision.ts`：四项中的疲劳/减组/课次身份及学习字段类型。
- `src/lib/core/brain-loop.ts`：完成反馈只记录NOT_TESTABLE，不自动给建议记成功。
- `src/lib/core/training-decision.test.ts`：3处旧READY期望更新为CAUTION。
- `src/lib/core/fk-r4-p0.test.ts`：附件7例加8例本地边界/数据不变性用例。
- `package.json`：仅把R4用例加入既有npm test入口，未改依赖、构建或页面配置。
- `scripts/test-loader.mjs`：仅在Node SSR测试中忽略普通CSS副作用导入，生产Vite样式仍原样加载；不改UI源码、样式或SSR断言。

除以上文件外，1134个原源码文件与基线逐文件SHA256一致。原始训练事实、事件、旧学习记录、备注、能力记录和正式计划使用合成内存存储验证保留；未打开真实运动员数据库或覆盖任何浏览器存储。`applyAdjustment`只返回新的执行候选，保持原输入及持久化正式计划不变，仍需既有用户确认流程。

## 未解决/不在本次范围

1. 历史力量进阶、旧建议陈旧判断、疲劳到下一课的完整反馈链、训练时长口径、专项训练目的等P1/P2未实施。
2. 旧版疲劳阈值仍是启发式保护提示，不能解释为疲劳确诊或经过验证的常模；高分只形成待核对候选，低分不许可加量。本轮没有新增科学阈值。
3. 历史`success:true`没有回写。后续统计不得把没有事前验证依据的旧标签当教练正确率；本轮只纠正新反馈写入语义。
4. 重复使用模板且缺稳定身份的旧记录仍显示UNKNOWN，不能凭日期或动作名称擅自拼课。本次没有为原始旧数据补造ID。
5. 未进行真实数据迁移、浏览器端整流程、真机或外部模型验收。研究包96例并不等于本次执行了96例模型评测。

## Grok复测

1. 完整源码包可直接用于独立环境；小修复包仅用于基线 `fk-ui-polish-full-source.zip`，SHA256：`18e78a69d32f2f4de309148de75548551a2eb7f458a279acbed7e9dddeac79d4`。先按`修改文件.json`核对每个修改前哈希；若不同，做差异合并，不直接覆盖。
2. 使用Node22和原package-lock，独立环境执行`npm ci`、`npm run typecheck`、`npm test`、`npm run build`。
3. 定向执行：`node --import ./scripts/test-register.mjs src/lib/core/fk-r4-p0.test.ts`。
4. 日志包包含`reproduce/run-local-regression.py`；将它放在包含`source/`的父目录，运行可补齐74个额外测试。只使用合成数据，测试所需本地进程通信应可用；不配置付费模型密钥，不部署。
5. 同时核对15例与真实调用路径：低疲劳分不恢复READY、1组动作不增为2组、其他动作不被减组、两次同模板不合并、切换运动员不串课、完成训练不记预测成功、旧事件与计划未改。

## 回退

完整回退包是上述UI精修基线。另提供小型代码回退包，恢复5个修改前文件并按清单移除新增测试/文档；先核对哈希并保留之后的改动。不清空localStorage、IndexedDB、事件日志或历史判断。所有交付ZIP有CRC与SHA256校验。
