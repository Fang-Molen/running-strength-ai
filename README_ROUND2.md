# 方坤 AI Brain 第二轮候选

完整交付报告：`docs/cognition-r2-delivery.md`。架构理由、数据边界与回退：`docs/cognition-r2-change-and-rollback.md`。完整源码位于本目录；正式版和真实个人训练数据没有被覆盖。

## 已连接的页面

打开原应用的方坤教练页面，新增“从目标建立首周计划”。400米目标问答可进入首次使用流程；依次确认目标、当前能力、近期实际训练、期限、可用时间、限制与恢复。可以返回更正各步。信息足够后显示7天候选、来源与限制、竞争假设和退出条件；可减少已有时长/组次、保存修改、接受或拒绝。新候选不会自动替换正式课表。

反馈仍使用原跑步记录绑定的发生实例与实际分段，再在400米推理反馈面板记录预测、实际24h/48h观察及更正/撤回。没有绑定事实或可比条件时不会学习成个人规律；预测晚于实际观察会被拒绝；不同项目与不同上下文不会自动迁移负荷。

## 技术复现命令

```sh
npm ci
npm run typecheck
npm test
npm run test:domain
npm run replay:first-week
npm run replay:cognition -- quality/cognition/original24.json evidence/round2/original24-replay-new.json
npm run build
npm run dev
```

构建会运行原迁移器。隔离验证时不配置正式 DATABASE_URL；本轮测试明确将其置空，未连正式数据库。`scripts/candidate-http-smoke.mjs` 启动自己的候选开发进程后读取HTTP与鉴权标志，再停止该进程；附 `--built` 验证当前已构建输出。`runtime-network-fallback.cjs` 只用于本轮测试环境，不由应用导入。

浏览器验收未通过，不能据本文件中的Node或HTTP结果批准发布。不是让用户代做验证；具体阻断及未验证矩阵已经记录在报告。
