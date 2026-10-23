# BUILD 09 · 教练页打开与用户主动决策

## 代码范围

BUILD 08 已由 Grok 在平台工作区报告功能验收通过并冻结（400/400、390 像素身体反馈与一次真实提问）。本包以 Codex 的 BUILD 08 验收候选为基线，BUILD 09 只修改教练页的打开/决策呈现流程，不修改冻结的训练事实、证据、跑步结构、Strength、TrainingFact 或决策规则。

打开教练页现在调用只读 `readCoachOpenView()`：从现有事实派生状态，读取已有 Decision 和最近完成训练的 ID。它不生成 Decision、不刷新状态包、不补写学习记录。已有建议仍显示，已拒绝的旧建议也继续显示处理状态；没有建议时用户可点击“生成或查看训练建议”调用原 `issueTrainingDecision()`。完成训练后的学习复盘改为用户点击“记录本次复盘”时调用原 `outcomeFeedback()`，重复点击由原函数去重。

移除了没有任何入口的旧 `held` 反馈分支及其教练页 `onPlan` 回调。这段死代码曾包含未绑定的疼痛事件和直接交给父组件改课表的路径；当前有效问答一直走服务端模型及用户确认的证据/选择事件。

变更文件：`src/lib/core/coach-open.ts`、`coach-open.test.ts`、`src/components/coach-sheet.tsx`、`src/components/strength-app.tsx`、`package.json` 和本报告。

## 本地验证

- 核心测试 162/162 PASS，应用数据/鉴权 4 个测试文件 PASS。
- `npm run typecheck` PASS；`npm run build` PASS；无 `DATABASE_URL` 时迁移按既有逻辑跳过。
- 完整 `npm test` 的平台脚本在本可移植包缺 `.grok/skills/og` 等平台夹具时失败；不能称为平台全量通过。
- 当前环境缺 xAI 密钥，云浏览器拒绝本地预览地址，Playwright Chromium 下载失败；未完成 390 像素 UI 和真实模型测试，BUILD 09 待平台验收，不冻结。

测试直接比较打开视图前后整个存储：无新事件、Decision、状态或学习记录；显式调用原决策函数才生成一次 `AI_DECISION_CREATED`，再次调用不重复；已拒绝建议的只读回看不创建新决策；完成训练只读打开不写学习。

## 平台验收重点

逐文件合入，保留 `.grok/`，干净安装并重跑 `npm test`、`npm run typecheck`、`npm run build`。在 390 像素页面预置一个训练计划，无 Decision：记录进入教练页前后的事件、Decision、状态包与课表；打开/关闭/重开都不能写 `AI_DECISION_CREATED` 或学习记录。点击“生成或查看训练建议”才允许出现一条 Decision/对应创建事件；重开和重复点击不得再创建。预置已拒绝 Decision 要看到原处理状态。完成训练后，打开教练页不补学习；点击“记录本次复盘”只写一次学习。确认已有问答、证据补记、接受/拒绝/修改/Override 与 BUILD 08 不回归。

注意：整个 App 的 `bootCore()` 仍会在首次加载时按原有启动逻辑迁移旧数据并刷新派生状态；本次只移除了**打开 CoachSheet** 引起的额外刷新与决策/学习写入。切勿把首次加载的迁移或状态更新时间混称为教练页写 Decision。

旧预览密钥在 broker 端作废状态仍未确认，App 不发布。25 秒模型偶发超时根因未知，不声称已解决。
