# 方坤 测试版 · 改动记录

| 日期 | 改动 | 原因 | 文件 |
|---|---|---|---|
| 2026-10-16 | 测试版正式基线上线（molen-fangkun.pages.dev）：6 个标签、方坤本地引擎、反馈按钮、佳明服务端会话、IndexedDB 保险箱、400m 计划 V4（+7 天） | 用户要先用起来、存数据 | 见 README-LIVE.md，tag live-baseline-20261016 |
| 2026-10-16 | 去掉各页的说明小字、开发备注和免责声明（约 40 处）；400m 计划去掉“日期待确认”，最终测试定在 12/28 | 用户要页面简洁；用户确认 12/28 | plan400.tsx, plan400-v4.json, garmin-sync.tsx, strength-app.tsx, coach-sheet.tsx, today-board.tsx, day-card.tsx, training-log-panel.tsx, health-extras.tsx, health-tiles.tsx, coach-panels.tsx, goal-home.tsx |
| 2026-10-16 | 数据延续：schema 迁移只能追加；新增迁移测试（用测试版数据快照验证升级不丢）；每天自动本地快照，保留最近 7 份，可恢复；大版本更新 / 14 天没导出时提醒备份 | 正式版上线后自动带上现在的数据 | src/lib/vault.ts, src/lib/vault-migration.test.ts, src/lib/__fixtures__/vault-beta1-snapshot.json, garmin-sync.tsx, package.json |
| 2026-10-16 | 佳明同步加固：每个请求 20 秒超时，每天三项并行，显示进度，失败时显示原因（不再一直显示“同步中…”） | 用户反馈卡在“同步中” | garmin-sync.tsx |
| 2026-10-16 | sw 缓存 fr255-shell-4 | 前端更新 | public/sw.js, scripts/sw-migration.test.mjs |
