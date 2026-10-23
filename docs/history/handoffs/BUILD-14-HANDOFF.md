# BUILD 14 候选：下一课综合建议范围与来源校验

## 目标与实现

BUILD 14 增加 `CoachNextSessionView`。它把本次训练归属、重复冲突、绑定疼痛、RPE、主观恢复、睡眠、酸痛、赛前 28 天和减量周合成为下一课建议范围：先选训练、先解冲突、先补恢复、只谈恢复/减量、保持或减量、只保持。该投影不写 Decision、不改课表、不改疲劳分，也不制造训练负荷分。

当前版本的 `increaseSupported` 固定为 `false`：现有单次/纵向事实能支持追问、保持、减量或恢复建议，但没有独立的负荷处方引擎来证明应当增加距离、速度、组数、重量或强度。模型若批准加量，服务端拒绝采用。后续若要开放增加训练，必须另建可审计的处方合同，不能靠模型自由文本绕过。

建议来源校验会为真正触发约束的事实建立 `requiredSourceIds`。若回答说下一课应保持、减量、恢复或停止，却没有同时引用对应的高 RPE、低恢复、短睡眠、疼痛、酸痛、赛期或周期来源，答案会被拒绝。只做事实复述时不强迫进入下一课建议。

教练页快捷问句更新为下一课综合建议、伤痛回归、三次纵向、掉速归因和高 RPE 五类入口；自然语言输入和用户接受、拒绝、修改、Override 权不变。

## 文件

- `src/lib/core/coach-next-session.ts`
- `src/lib/core/coach-next-session.test.ts`
- `src/lib/core/coach-brief.ts`
- `src/lib/core/coach-brief.test.ts`
- `src/lib/strength/coach-ai.ts`
- `src/lib/strength/coach.ts`
- `package.json`

## 本地验证边界

- 应用数据/登录：55/55 PASS。
- 核心：174/174 PASS。
- `npm run typecheck`：PASS。
- `npm run build`：PASS；未设置 `DATABASE_URL`，迁移跳过。
- 平台脚本在可移植工作区为 189/197；8 个失败都来自缺少 `.grok/skills/og` 和平台 `app-env.json`，不是功能断言失败。平台工作区保留这些文件后，预期总数为 197 + 55 + 174 = 426，但必须由 Grok 实跑，不能预写 PASS。

本环境无真实模型调用和 390 像素验收，因此 BUILD 14 是候选，不冻结、不发布。25 秒上游等待上限未修改；旧预览密钥在 broker 端是否作废仍是发布阻塞。

平台首次验收后的阻塞与修正见 `BUILD-14-1-HANDOFF.md`。平台真实结果优先于本文件中的预期测试数量。
