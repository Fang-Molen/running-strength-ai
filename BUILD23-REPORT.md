# BUILD 23 — 方坤前台事件感知候选

## 已完成
- 新增 `src/lib/core/coach-activity-watch.ts`：只读解释 TRAINING_STARTED、TRAINING_COMPLETED、SESSION_RPE；高 RPE 不作疲劳诊断。
- `CoachSheet` 订阅已有 `onAppEvent`，在方坤页面显示最近 5 条事件提示；事件去重、清除提示；卸载时取消订阅。
- 仅当前页面挂载期间监听，未写历史记录、未修改训练计划、未上传数据。
- 运行 `node --experimental-strip-types --test src/lib/core/coach-activity-watch.test.ts src/lib/core/coach-local-first.test.ts`：13/13 PASS（7 新增、6 回归）。

## 未完成及阻碍
- 缺少 node_modules，`tsc --noEmit` 因缺失 node 和 vite/client 类型而失败；不是 TypeScript PASS。
- 未运行全量测试、生产构建、真实浏览器或手机 PWA 验证。
- 当前提示只监听事件总线，不监听营养存储/跨标签页变更；页面关闭后不会监控。
- 未接入联网公共知识服务、服务端模型申请审批/赠送额度。不能通过 localStorage 模拟真实可防滥用的赠送额度。
- 线上模型必须由用户明确操作并经服务端鉴权；此候选没有修改服务端额度权限。

## 下一阶段
- 在可安装依赖环境执行完整 typecheck/build 与回归；逐步接入饮食与身体记录的真实变更源。
- 设计可审计服务端额度台账与用户明确同意的数据出站机制；不把健康数据默认发送给第三方。
