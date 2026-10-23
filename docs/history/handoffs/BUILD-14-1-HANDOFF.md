# BUILD 14.1 候选修正：正式纵向问题、否定式安全结论与结构化输出

## 来自平台验收的真实问题

BUILD 12.2–14 首次平台验收发现三类阻塞：正式纵向事实包没有把当前问题放在顶层，模型在恢复问题中会顺带复述跑步秒数；安全守卫把“不能确认已经恢复”误判成肯定康复结论；模型偶尔返回不可核对 JSON。25 秒连接阶段超时仍然存在，但不在本修正中改变等待上限。

## 修正

1. `compactCoachSeriesPacket()` 现在显式携带当前 `question`，并保留每次训练的完成事件、恢复及身体反馈来源。模型被要求只回答该问题：恢复问题不顺带复述跑步秒数，用时问题不顺带评价恢复。
2. 医学清除与身体反馈守卫改为逐句、否定感知。“现有证据不能确认已经恢复正常训练”“不能说明没有疼痛”和询问“是否已经恢复”可以通过；肯定宣称已痊愈、安全回归、没有伤病风险仍被拒绝。
3. xAI Chat Completions 请求增加严格 `json_schema` structured output，固定回答字段及类型，减少不可解析 JSON。模型仍不能绕过服务端事实与安全守卫。
4. 下一课建议提示明确要求完整引用 `nextSession.requiredSourceIds`；回归训练结论需引用 `returnToTraining.sourceIds`。
5. 服务端增加不含训练原文的标准化 guard 日志：`ACCEPTED`、`ASK`、`MODEL_OUTPUT_INVALID`、`MEDICAL_CONCLUSION`、`NEXT_SESSION_SOURCES`、`SERIES_TIME_SOURCE`、`SERIES_RECOVERY_SOURCES` 等，便于平台定位拒绝阶段。

## 验证边界

Codex 聚焦测试 18/18、实际 npm 核心清单 162/162、应用/登录 55/55、typecheck、production build 均通过。可移植环境仍缺平台 `.grok` 夹具；没有 xAI 密钥，真实调用必须在平台复验。BUILD 12.2、13、14、14.1 均不由 Codex 冻结，App 不发布。
