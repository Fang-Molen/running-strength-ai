# 疲劳分账本审计（BUILD 23 候选，未改公式）

这是只读审计。没有改 `coach.fatigue`、72 相关阈值、AthleteState 或今日 Decision。

## 旧分数

- 存储：`fr255-coach-v2` 的 `fatigue` 与 `band`。缺记录时 `freshMemory()` 使用 20，档位 `ready`。
- 读取：不是数字就回到 20。`absorbFeel` 用 `memory.fatigue || 20`，所以 0 也会被当成 20。
- 输入：本次感觉。轻松 -10，刚好 -2，不适 +16，偏重 +28。跳过不改。结果限制在 0–100。只保留最近 8 条笔记。
- 没有单独的时间窗口。笔记不会按 24 小时或 72 小时过期。
- 显示：教练页另有一句，没有证据时写 UNKNOWN，并说明不是疲劳百分比。状态卡仍调用 `recoveryLabel`。默认档 `ready` 会写成「正常」。这和 UNKNOWN 并排，本阶段没有改。
- 这个分数会进入 AthleteState 的 `recovery.fatigueScore`，因此今日规则建议能读到它。试用版不把它当成科学疲劳百分比，也不自动改课表。

## 没有接上的证据层

`evidence-fatigue.ts` 的 `FATIGUE_EVIDENCE_V1` 只读训练事实里的高主观强度、短睡眠、低恢复。结论固定是 UNKNOWN。它不写入 `coach.fatigue`，也不能抵消疼痛。

疼痛和酸痛仍是分开的事实。低疲劳分不能取消疼痛边界。下一课若要写成「保持、减量、恢复或先追问」，必须另有来源，并且只能作为候选，不能在这一阶段直接改 Decision。

## 本阶段不做

不新增伤病分级，不写康复处方，不把单次用时变化解释成神经疲劳或乳酸能力不足。
