# AI Brain V3 对抗测试与修复报告

## 范围
在 V2 候选源码副本上修改离线问答安全分流和对话输出一致性；不修改冻结 V3.3 引擎结构，不发布 App，不触碰用户 localStorage，不接入 GPT API。

## 可复现测试
`node --experimental-strip-types --test src/lib/core/coach-question-reasoning.test.ts src/lib/core/coach-adversarial.test.ts`

结果：22/22 PASS（原有8项 + 新增14项）。首次运行20/22，失败的是否定胸痛及已评估历史胸痛仍触发 CAUTION；修复后22/22。

## 代码变更
- `src/lib/core/coach-question-reasoning.ts`：分句检查急症关键词；局部否定、已评估且明确无当前症状的历史情况不再一律升级；疼痛 CAUTION 同步排除明确否定及已解决历史描述。
- `src/lib/core/coach-athlete-dialogue.ts`：急症情况下 `predictionStatus` 与被屏蔽的成绩换算保持一致。
- `src/lib/core/coach-adversarial.test.ts`：14项新对抗回归测试。

## 仍未解决的限制
- 仍是正则启发式，复杂否定、引用、反问、多主体、时间线和隐含症状可能误判；不能用于自动临床放行。
- 尚未接入完整 AthleteState、正式训练事实、真实多日学习、知识库检索质量评估及完整130题。
- 无法声称当前3000米成绩预测已完成个体校准。
- 未运行完整 TypeScript 类型检查、生产构建和浏览器回归。

## 后续优先级
1. 扩充对抗语料，区分漏报与误报；安全场景以漏报为更严重问题。
2. 引入有出处的事件事实和状态转移，跨日追踪而不是关键词记忆。
3. 训练目的与成绩预测使用计划/实际/休息/RPE/比赛PB日期等可追溯输入。
4. 运行完整130题和端到端 App 回归后才考虑上线。
