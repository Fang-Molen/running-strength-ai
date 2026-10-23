# BUILD 14.4 候选：严格结构化输出的 SSE 传输探针

## 背景

BUILD 14.3 平台验收已冻结 12.2、14、14.1、14.2；BUILD 13 与 14.3 仅因“酸痛回归”连续三次在响应头前达到 25 秒而阻塞。恢复冲突也连续三次没有正文。此时继续缩短约 1.1–1.3K 字的事实包缺少证据，不能解释上游连接阶段超时。

xAI 官方文档说明文本模型支持 SSE 流式输出，并明确支持 `response_format` 与流式结构化输出的组合。14.4 因此只做传输层候选：同一模型、同一严格 Schema、同一事实包与同一总超时，增加 `stream: true`，在服务端完整收齐后才进入原守卫。

## 实现

1. 新增 `coach-stream.ts`，增量解析 SSE `data:` 事件并拼接 `choices[].delta.content`。
2. 只有收到 `finish_reason=stop`，或收到 `[DONE]` 且没有失败结束原因，才认为完整。`length`、断流、畸形事件、上游 error、超过 64 KiB 或内容超过 16K 字全部失败。
3. 超时或断流时不把半截 JSON 交给教练守卫，不生成固定回答；用户仍看到原失败状态并保留手动重试。
4. 25 秒 `AbortSignal.timeout` 从请求开始贯穿读取完整流，没有延长，也没有第二次自动模型调用。
5. 日志新增 `transport=sse`、`first_delta`、`stage=stream`、完成状态与 finish reason，只记录类型、时间和大小，不记录问题、训练原文或输出正文。
6. 若代理忽略流式参数并返回完整 JSON，则走原非流式解析；HTTP 非 2xx 不尝试采用正文。
7. 同步平台 14.3 的守卫补丁：单独的“已经安全回归”同样拒绝；否定式“不能确认安全回归”继续放行。

## 未改变

模型仍是 `grok-4.5`；严格 `json_schema`、最大输出、事实来源和全部安全守卫不变。训练事实、证据、Strength、TrainingFact、跑步结构、事件、课表、Decision、疲劳分、用户权利和 localStorage 信任边界不变。App 不发布，不开始 BUILD 15。

## Codex 本地验证

- SSE 聚焦测试 5/5 PASS：跨 chunk 拼接、缺 `[DONE]` 但 stop、半截断流、`length`、畸形事件。
- 应用/登录 55/55 PASS。
- 核心 171/171 PASS。
- `npm run typecheck` PASS。
- `npm run build` PASS；无 `DATABASE_URL` 时迁移跳过。
- 可移植副本直接执行 `npm test` 时，平台脚本为 189/197；8 项失败均指向缺少 `.grok/skills/og` 与平台 `.grok/app-env.json`。这不是应用/核心测试失败，也不能写成 Codex 全量通过。若 Grok 平台夹具与 14.3 相同，完整总数预计为 423，必须以平台实际结果为准。
- Codex 环境没有 `XAI_API_KEY`，SSE 与真实 xAI 的联合行为必须在 Grok 平台核验。

BUILD 13、14.3、14.4 不由 Codex 冻结。
