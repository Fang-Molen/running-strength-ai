# BUILD 29 — 方坤联网状态与前台记录刷新候选

## 已修改
- `src/components/coach-sheet.tsx`: 监听浏览器 online/offline，展示设备联网状态。联网状态只作提示，基础本地回答不依赖网络。
- 线上调用前检测离线状态，离线不调用 `askCoach`；入口提示问题及训练摘要可能发送给服务端，明确未实现赠送额度发放。
- App 事件到来后刷新训练 occurrence 选项与当前燃料摘要，保留显式绑定约束，不根据日期猜测训练关联。
- 保持原有本地问答、历史数据和用户对决策的最终控制权。

## 实际验证
- `node --experimental-strip-types --test src/lib/core/coach-activity-watch.test.ts src/lib/core/coach-conversation-context.test.ts src/lib/core/coach-record-context.test.ts src/lib/core/coach-local-first.test.ts`
- 结果 24/24 PASS；输出见 `BUILD29-TESTS.log`。
- 新增浏览器状态与 UI 交互尚未完成自动化 E2E 测试；不把这 24 项称作浏览器验收。

## 未完成 / 阻塞
- 当前候选环境没有 node_modules，未运行完整 TypeScript 检查或生产构建。
- 未完成真实浏览器交互、离线 Service Worker 冷启动、iPhone PWA 测试。
- 尚未接入联网知识检索、服务端额度发放与申请审批。设备联网不代表具备联网检索。
- 未发布线上版本、未迁移或覆盖用户数据。
