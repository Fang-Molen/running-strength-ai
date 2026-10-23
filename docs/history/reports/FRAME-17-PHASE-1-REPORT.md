# FRAME-17 Phase 1 — 本周成长预览

## 已实现
- 日志页面展示本周成长卡、XP、等级、进度、反馈数量。
- 只读取现有 `plan.cycle.logs`，按 `sessionId` 去重；反馈记录每节 15 XP，跳过/休息记录每节 5 XP。
- 现有训练周数据不等于长期训练事实；明确标记“本周预览”，不虚构终身等级。
- 在线 AI 体验卡仅为权益说明，`levelFiveEligible` 固定 false；无发卡、无真实额度、无服务端授权。
- 未修改原有训练、营养、设备、训练事实与 AI 决策。

## 验证
- `node --experimental-strip-types --test src/lib/ui/athlete-growth.test.ts`: 2/2 PASS。
- ZIP 完整性：见交付检查。
- TypeScript、生产构建、全量测试、浏览器与真机：NOT TESTED（依赖未安装）。

## 后续
- 统一正式训练记录与独立 RPE/疼痛/恢复反馈后，再设计跨周可审计的长期成长账本。
- 服务端验卡、发卡、计费、额度扣减需安全后端；绝不可由 localStorage 直接决定。
