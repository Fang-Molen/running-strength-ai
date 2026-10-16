# 方坤 测试版 · 改动记录

| 日期 | 改动 | 原因 | 文件 |
|---|---|---|---|
| 2026-10-16 | 测试版正式基线上线（molen-fangkun.pages.dev）：6 个标签、方坤本地引擎、反馈按钮、佳明服务端会话、IndexedDB 保险箱、400m 计划 V4（+7 天） | 用户要先用起来、存数据 | 见 README-LIVE.md，tag live-baseline-20261016 |
| 2026-10-16 | 去掉各页的说明小字、开发备注和免责声明（约 40 处）；400m 计划去掉“日期待确认”，最终测试定在 12/28 | 用户要页面简洁；用户确认 12/28 | plan400.tsx, plan400-v4.json, garmin-sync.tsx, strength-app.tsx, coach-sheet.tsx, today-board.tsx, day-card.tsx, training-log-panel.tsx, health-extras.tsx, health-tiles.tsx, coach-panels.tsx, goal-home.tsx |
| 2026-10-16 | 数据延续：schema 迁移只能追加；新增迁移测试（用测试版数据快照验证升级不丢）；每天自动本地快照，保留最近 7 份，可恢复；大版本更新 / 14 天没导出时提醒备份 | 正式版上线后自动带上现在的数据 | src/lib/vault.ts, src/lib/vault-migration.test.ts, src/lib/__fixtures__/vault-beta1-snapshot.json, garmin-sync.tsx, package.json |
| 2026-10-16 | 佳明同步加固：每个请求 20 秒超时，每天三项并行，显示进度，失败时显示原因（不再一直显示“同步中…”） | 用户反馈卡在“同步中” | garmin-sync.tsx |
| 2026-10-16 | sw 缓存 fr255-shell-4 | 前端更新 | public/sw.js, scripts/sw-migration.test.mjs |
| 2026-10-16 | 全站说明小字隐藏（CSS：p.text-xs.text-muted 等，状态值加 .keep 保留）；页头副标题、恢复卡说明、口径说明去掉；同步结果只显示“同步完成 新增 N 条” | 用户要只留状态值 | styles.css, body-center.tsx, health-extras.tsx, strength-app.tsx, garmin-sync.tsx |
| 2026-10-16 | 佳明力量训练自动识别为力量（没有分组明细时，用总时长记成一条力量记录，不编造组数）；保存失败的活动下次同步会重试 | 10/05、10/08 力量课提示“请选择跑步、力量或混合训练” | device-store.ts, garmin-sync.tsx |
| 2026-10-16 | 日志页新增“佳明活动”：按周折叠，先显示 10 条，可展开更多；每行显示名称、距离、时长、配速、心率，力量课显示组数；点开看详情，跑步分圈从佳明实时拉取并存在本机；旧的“佳明账号同步 / 已确认上传”条目不再显示 | 列表太长，点开没有数据 | garmin-log.tsx, garmin-sync.tsx（同步时存完整摘要，最多 200 条）, training-log-panel.tsx, strength-app.tsx |
| 2026-10-16 | 今日“自己加一节”：自由搭建（跑步 / 力量 / 混合 / 其他 → 子类型或部位、距离/组数、动作、上午或晚上、时长）；预设课保留为快捷按钮；会跟当天的 400m 计划做冲突提示 | 用户要自己搭课 | custom-session-builder.tsx, today-board.tsx |
| 2026-10-16 | 底部导航改成 今日 / 计划 / 饮食 / 日志 / 健康；方坤从导航栏移到每页右上角按钮，打开后全屏，再点 X 返回原来的页面 | 用户要求 | strength-app.tsx |
| 2026-10-16 | sw 缓存 → fr255-shell-7 | 前端更新 | public/sw.js, scripts/sw-migration.test.mjs |
| 2026-10-16 | 部位按钮现在能多选并高亮，按部位筛选动作库（app 自带 78 个动作 + 计划里的动作）；动作可以加、删、调顺序，每个动作能填组×次×重量×RPE。400m 计划每天的力量块可编辑，存成“我的安排”，PDF 原文照常显示，能一键恢复原计划 | 部位按钮点了没反应；没法从动作库加动作 | exercise-editor.tsx, custom-session-builder.tsx, plan400.tsx, day-schedule-rules.ts（加了可选字段 exercises） |
| 2026-10-16 | 合并 UI设计 的 BodyLab「体型变化」（3D / 2D 人偶，左边是现在、右边是目标情景，默认读个人资料里的身高、体重、体脂；可调可保存，存在 fk-bodylab-v1）→ 放在健康页的折叠卡片 | 用户问体型变化功能在哪 | src/components/bodylab/*, public/fangkun-bodylab/*, strength-app.tsx |
| 2026-10-16 | 合并 3D 动作演示库（76 个动作，2D/3D 演示 + 肌肉图）；动作编辑器里每个动作有「演示」按钮，点开全屏看 | 用户要动作库能看演示 | src/lib/strength/demo/*, src/components/exercise-demo.*, public/demo3d/*, exercise-editor.tsx |
| 2026-10-16 | sw 缓存 → fr255-shell-8 | 前端更新 | public/sw.js |
| 2026-10-16 | 每个动作都有剂量类型：次 / 秒（平板、侧桥等静力）/ 米（农夫行走等）、是否每侧（单腿、Pallof、侧桥…）、是否自重（重量栏显示“自重”）；单位列跟着变，默认值合理（平板 3×30秒），可以手动改单位；400m 计划力量块解析“20秒”“/腿”；新测试把 88 个库动作的类型都检查一遍 | 平板等计时动作显示成“次” | exercise-editor.tsx, plan400.tsx, src/lib/exercise-dose.test.ts, package.json；sw → fr255-shell-9 |
| 2026-10-16 | 今日课的状态：再点一次当前状态就改回“待做”，并弹出 5 秒“撤销”；选了“没练”后还能打开、改动作、填 RPE 和备注，状态随时能改；状态是每节课一个字段，最后一次点击生效，400ms 防抖，不会重复写日志；启动时自动合并同日同课的重复条目，保留最后一次记录（记在 fk-dedupe-log） | 误点没法撤销；“没练”后卡片锁住；连点产生重复 ；展开课卡直接显示完整动作清单和逐组打勾（不用先选状态），状态按钮放在后面、可选 | day-schedule-rules.ts(+test), today-board.tsx；sw → fr255-shell-v10 |
