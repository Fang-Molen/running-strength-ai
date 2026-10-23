# 新版 UI AI 大脑权限集成候选报告

来源：用户上传 running-strength-source.zip。该包包含 src、package.json、五导航新版 UI。

## 已写入真实 TypeScript 源码
- `src/lib/core/adaptive-plan-permissions.ts`：计划修改权限仲裁；当日/次日须确认；未来2–7天提示；8天以上周期复核；疼痛及功能受限优先安全复核；计划版本冲突拒绝。
- `src/components/coach-plan-sheet.tsx`：在新版「跑步＋力量周期计划」页面加入训练前不适反馈与权限预检 UI。
- `src/lib/core/adaptive-plan-permissions.test.ts`：8项测试通过。

## 未实现、不能宣称已实现
- 当前只是 UI 预检及只读权限仲裁，尚未接入实际计划修订提交、通知送达、真实 AthleteState/Decision 写入、用户确认事件持久化。
- 不能仅凭用户点击确认解除高风险疼痛警报。
- 不修改历史训练数据、本地存储 schema、线上发布。
- 本环境没有 node_modules；npm run typecheck 由于缺少 @types/node 和 vite/client 类型而无法运行，未宣称 typecheck/build PASS。需要在有依赖环境执行 npm ci、npm run typecheck、npm test、npm run build。

## 测试
`node --experimental-strip-types --test src/lib/core/adaptive-plan-permissions.test.ts` => 8/8 PASS。

## 后续
接入原有计划版本与事件模型，并在用户明确批准具体当日调整后产生可追溯事件；安全审核始终优先。所有写入必须以原始计划不可变快照为依据。
