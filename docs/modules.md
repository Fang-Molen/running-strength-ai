# 方坤区块表（modules）

目的：改一处只动一个小区块，复测只跑这个区块。区块定义只有一份：`scripts/blocks.mjs`（本页是它的说明）。

## 复测一个区块

```bash
npm run test:block:c03            # 只跑 C03 区块（先查 import 边界，再跑该区块测试）
node scripts/test-block.mjs read-model quick-log   # 一次跑几个区块
npm run check:blocks              # 只查所有区块的 import 边界
```

改了哪个区块就跑哪个；改了区块的**入口文件导出**（别的区块在用）时，再加跑用到它的区块。发版前仍跑全量。

## 区块

| 区块 | 文件夹 / 主要文件 | 入口 | 不得 import |
|---|---|---|---|
| read-model | `src/lib/ui/training-read-model.ts`、`plan400-view.ts`、`v4-exec.ts` | training-read-model.ts | lib/coach、components |
| plan400-components | `src/lib/ui/plan400-components-store.ts`、`plan400-start.ts`、`src/lib/core/ownership.ts` | plan400-components-store.ts | lib/coach、components、read-model |
| quick-log | `src/lib/ui/quick-log.ts`、`quick-log-save.ts` | quick-log-save.ts | lib/coach、components、read-model |
| garmin-link | `src/lib/ui/run-link.ts`、`lap-structure.ts`、`src/lib/health/garmin-*` | run-link.ts | lib/coach（类型除外）、components |
| schedule | `src/lib/ui/day-schedule*.ts`、`guided-discard.ts`、`scheduled-execution.ts` | day-schedule.ts | lib/coach、components |
| coach-local | `src/lib/coach/plain-coach.ts`、`src/lib/core/coach-local-first.ts`、`coach-first-week.ts`、`coach-plan.ts` | coach-local-first.ts | online-coach、deepseek、plan-execution |
| coach-stated | `src/lib/coach/stated/parse.ts`、`compute.ts`、`compose.ts` | compose.ts | online-coach、deepseek、plan-execution、components、storage（只读、不保存） |
| coach-online | `src/lib/coach/online-coach.ts`、`functions/api/coach-chat.js` | online-coach.ts | c03、plan-execution、server/coach-deepseek |
| c03 | `src/lib/coach/c03/{argument,evidence,followup,runtime}.ts` | runtime.ts | components、online-coach、deepseek、plan-execution、day-schedule |
| review-view | `src/lib/coach/review-view/{session-option,plain-review,host}.ts`、`components/coach-review-plain.tsx`（复盘页 `coach-offline-loop-panel.tsx` 只调用它） | plain-review.ts | online-coach、deepseek、plan-execution、c03、day-schedule、storage-journal（只读、不保存） |
| plan-execution（**阻断**） | `src/lib/coach/plan-execution/{core,store,host}.ts` | host.ts | components、online-coach、deepseek、c03、分项存储、记一笔 |
| health | `src/lib/health/snapshot.ts`、`recovery-quantitative.ts` | snapshot.ts | lib/coach、components |
| nutrition | `src/lib/nutrition/*` | food-db.ts | lib/coach、components |
| strength-ui | `src/lib/strength/guided-flow.ts`、`rest.ts`、`src/lib/ui/training-editor.ts` | guided-flow.ts | lib/coach、online-coach |

各区块的测试清单见 `scripts/blocks.mjs` 的 `tests`。旧路径 `src/lib/core/coach-c03-*.ts`、`coach-plan-execution*.ts`、`src/lib/ui/coach-plan-host.ts` 只是转发（re-export），新代码请从新文件夹引用。

## 固定规则（跨区块）

- 归属：唯一出处 `src/lib/core/ownership.ts`。新记录显式写 `athleteId`；旧无归属记录属于本机 `local`，`local` 可读、可原地改，但不补写归属（不迁移）；其他运动员看不到、也改不了。首周计划生成/采纳、候选课表采纳和偏好来源仍只认显式归属。
- 联网方坤默认开启（用户 t460），客户端问题上限 = 线上服务端截断长度（1000），超限不发请求。
- 改课：`plan-execution` 宿主固定 `UNCOORDINATED` / 日历 `UNKNOWN` / 安全 `UNKNOWN`，确认和撤销必然阻断；页面上的日期差异不是已保存的可执行提案。`scripts/check-blocks.test.mjs` 会在有人把它改成放行时报错。
- 手表跑步关联必须用户确认；不补造时长；旧整课只读、RPE 不拆；同一训练只算一次。

## 后续拆分（未在本轮做）

最大的文件仍是整块：`components/strength-app.tsx`（约 1300 行）、`track-session.tsx`（约 1100 行）、`coach-sheet.tsx`（约 800 行）、`coach-first-week-panel.tsx`（约 660 行）。下一轮建议按页面区块拆出（首页 / 力量 / 复盘 / 设置），每拆一块就在 `scripts/blocks.mjs` 加一个 `ui-*` 区块和测试清单。本轮只把 C03 新增的复盘面板放在单独组件里（`coach-c03-followup-panel.tsx`、`coach-plan-change-panel.tsx`）。
