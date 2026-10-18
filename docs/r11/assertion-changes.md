# R11 断言变更

- 文件 `coach-r10-regression.test.ts`，`R10 whole-session ratings remain distinct from last-set ratings and segment duration`：旧 `/6 × 50 = 300 AU/` → 新 `/整课RPE 6 × 50 分钟 = 300 AU/`。落实 R11 指定单位格式；保留精确评分、时长、结果和冲突全部断言。
- 同文件 `R10 continuous distances, numerical lap order, recovery segments and unknown HR method survive import`：旧 `heartRates.length===11`、全部 UNKNOWN → 新 `heartRates.length===0`、`unverifiedHeartRates.length===11`、全部 UNKNOWN 且逐条匹配实际分段来源、`HR_AVG_BPM` 正式行数为零。未核实方法的实际数值仍保留且来源更严格；正式心率不再混入方法缺失的观察。原 R8 显式方法测试完全保留。
- 新建语料生成过程修正（非旧测试变更）：青少年反例中的“去年极限测试”不属于既往症状，应为 NONE；该三条换为“胸痛”负向语境以测试既往医疗信号，另单列既往极限测试无症状不升级的断言。

- `coach-curriculum.test.ts` 的 `full-session calculations use question numbers, not demonstration numbers` 测试：`/240任意单位/` → `/240 AU/`，统一 R11 指定 AU 单位；仍断言两节课分别计算且禁止示例值 270。
