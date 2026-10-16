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
| 2026-10-16 | 按设计稿改外观：深色 + 橙色主题；今日页头 FANGKUN / 更好的你 + 日期胶囊；首页卡片网格：今日饮食记录（4 餐状态 + 快速记录）、我的形象（BodyLab 3D 人物，正面/侧面/背面）、身体数据、目标进度、体型对比（当前 vs 目标体重）、今日营养环、体重趋势、健康记录、营养建议。都用真实数据，没数据就显示空状态 | 用户给了设计稿 design-ref/home.jpg | styles.css, home-dashboard.tsx, strength-app.tsx, bodylab-panel.tsx（导出 Model） |
| 2026-10-16 | 动作详情页按设计稿（design-ref/exercise.jpg）重排：名称 + 英文名、标签、推荐参数、3D 演示 + 肌肉图、准备/动作/呼吸/常见错误/安全/变式（来自动作库原有要领，标注未审校）；训练目标、适用人群、分级参数先标“待补” | 设计稿 | exercise-editor.tsx (DemoSheet)；sw → fr255-shell-v11 |
| 2026-10-16 | 饮食页折叠：要点/依据/训练时机默认收起；碳水·蛋白·热量一行；目标卡左侧留 3D 形象位 | 用户要求精简长文、给 3D 人像留位置 | fuel-guide.tsx |
| 2026-10-16 | 首页看板改为挂载后渲染（修 SSR 水合不一致）；测试 loader 支持 .css；sw → v12 | 测试失败修复 | home-dashboard.tsx, scripts/test-loader.mjs, public/sw.js |
| 2026-10-16 | 看板卡片移出今日：饮食记录/营养摄入/营养建议→饮食页；我的形象/身体数据/目标进度/体型对比/体重趋势/健康记录→健康页；今日只留训练；sw → v13 | 用户纠正：今日先看训练 | strength-app.tsx, home-dashboard.tsx, fuel-guide.tsx |
| 2026-10-16 | 全部看板卡片集中到饮食页（今日只留训练，健康页去掉看板）；营养建议卡显示碳水/蛋白/热量+练前练后摘要；点营养卡/饮食记录打开全屏「饮食详情与依据」（原饮食长文、引用、快速记录）；sw → v14 | 用户改定布局 | strength-app.tsx, home-dashboard.tsx |
| 2026-10-16 | 计划页折叠：只展开当前周，其他周一行标题；本周原则可折叠；日行单行紧凑（日期+星期一行）；sw → v15 | 用户要求计划页精简 | plan400.tsx |
| 2026-10-16 | 计划来源模式：顶部「当前计划」卡，导入课表（PDF/图片/文本，先保存待解析）为主，让方坤生成为备选，一次一个激活计划、切换保留旧记录（fk-plan-source-v1 / fk-plan-imports-v1）；激活 400m V4 时隐藏自动周期模板、首周候选等；400m 课仍可编辑；sw → v16 | 用户要求以导入计划为主 | plan-source.tsx, strength-app.tsx, hydration.test.tsx |
| 2026-10-16 | 400m 计划整卡可折叠：默认一行（计划名+当前周+已练数），展开见周列表；周行紧凑；sw → v17 | 用户要求 | plan400.tsx |
| 2026-10-16 | 饮食页按 diet-health.jpg 重排：饮食记录（可折叠餐次）；身体形象大卡（正/侧/背、当前/目标/对比、四项数据）；营养摄入环+4 条（碳水/脂肪/纤维未记录显示目标）；体重/体脂率/肌肉量趋势切换；健康记录 2×2（饮水待接入）；营养建议 4 行，点开详情与依据；目标选择移入详情页；sw → v18 | 用户给出设计稿 | home-dashboard.tsx |
| 2026-10-16 | 佳明同步、全部数据备份、设备导入移入 ⚙️ 设置；顶栏固定（安全区）、底部导航固定；sw → v19 | 用户要求健康页只放健康内容 | strength-app.tsx, body-center.tsx, styles.css |
| 2026-10-16 | 饮食小卡各开各的详情（营养摄入/体重趋势/睡眠/心率/HRV/饮水/蛋白/碳水/脂肪/纤维，含依据）；去掉饮食详情里重叠的人像；方坤头像按钮移到设置旁；顶栏与全屏页只用安全区+小边距（约 48px）；sw → v20 | 用户反馈 | home-dashboard.tsx, strength-app.tsx, fuel-guide.tsx, styles.css |
| 2026-10-16 | 分页重排：饮食=饮食记录+营养摄入+营养建议；健康=3D形象（当前/目标/对比）+本周身体变化+体重/体脂/肌肉趋势+恢复（睡眠/静息心率/HRV）；iOS 全屏：viewport-fit=cover、apple-mobile-web-app-capable、black-translucent、深色 theme/background；sw → v21 | 用户改定分页 | home-dashboard.tsx, strength-app.tsx, __root.tsx, manifest |
| 2026-10-16 | 最终分页：健康=身体看板；饮食=饮食记录/快速记录、营养摄入、营养建议、饮水、练前练后；营养建议换行、静息心率标签截断修复；sw → v21 | 用户定稿 | home-dashboard.tsx |
| 2026-10-16 | 健康页：3D 形象为主卡（点人像切 当前/目标 对比）→体重趋势→健康记录（睡眠/静息心率/HRV）→手表测不到的主观打卡+体重录入；去掉重复的恢复结论/指标卡和旧体型变化折叠；饮食页只留饮食记录/营养摄入/营养建议/练前练后；sw → v22 | 用户定稿 | home-dashboard.tsx, body-center.tsx, strength-app.tsx |
| 2026-10-16 | 日志页：本周概览卡（负荷柱、负荷数、7 天次数，依据藏在 ⓘ）置顶→训练记录→方坤复盘卡（今日/本周/最近一课分段，历史复盘小链接）；本周期感受+本周成长合并；全局折叠行去掉空白高度；sw → v23 | 用户要求 | r8.tsx, review-card.tsx, training-log-panel.tsx, strength-app.tsx, styles.css |
| 2026-10-16 | 记录饮食改为底部小面板：选餐次→写食物名/拍照（照片压缩后只存本机 IndexedDB fangkun-food-photos）→保存；不再跳到饮食详情页；FoodEntry 加可选 photo 字段（加法迁移）；sw → v24 | 用户要求 | home-dashboard.tsx, food-photo.ts, log.ts |
| 2026-10-16 | 记录饮食面板只保留：餐次、食物名+拍照、记录按钮；sw → v25 | 用户要求 | home-dashboard.tsx |
| 2026-10-16 | 日志顺序：我的能力雷达→本周概览→训练记录→方坤复盘→感受/成长；sw → v26 | 用户要求 | strength-app.tsx, training-log-panel.tsx |
| 2026-10-16 | 健康页按 home.jpg 网格：左我的形象高卡（点开全屏身体详情），右身体数据/目标进度/体型对比；体重趋势加 周/月/半年/年；健康记录含恢复状态；全屏身体详情：正/侧/背、当前/目标/对比、体成分（体脂率、肌肉量、双臂/躯干/双腿肌肉、内脏脂肪、水分、骨量、BMR）、手动记录、历史；BodyCheck 加可选字段（加法迁移）；sw → v27 | 用户定稿 | home-dashboard.tsx, body.ts |
| 2026-10-16 | iOS 顶部白条修复：html/body 深色背景+color-scheme dark、theme-color #0b0b0d、顶栏 sticky top:0，安全区内边距只在独立模式生效；sw → v28 | 用户截图反馈 | styles.css, __root.tsx, manifest |
| 2026-10-16 | 健康页去重：去掉旧体重与体成分卡/大体重卡/记录体重/历史（统一在我的身体详情）；健康记录+主观评价上移到形象行之后；身体数据卡可点开详情；详情页去掉重复数据行；SW 启动和回到前台时检查更新、换版自动刷新一次；设置里一次性提示 Safari 与主屏幕数据分开需导出/导入；sw → v29 | 用户要求 | home-dashboard.tsx, body-center.tsx, strength-app.tsx |
| 2026-10-16 | 主屏幕版首次打开（空数据）显示欢迎页：从 Safari 版迁移（选备份文件导入）+ 佳明登录 + 跳过；导出改用系统分享面板（可存到「文件」），不支持时回退下载；水合测试按新首屏更新；sw → v30 | 用户加到主屏幕后需重登 | strength-app.tsx, vault.ts, hydration.test.tsx |
| 2026-10-16 | 健康：主观感受卡全宽（图标标题、疲劳/酸痛行、紧凑橙色选中），去掉下方空隙；体重趋势时间段与指标合并为一行小分段；sw → v31 | 线上截图反馈 | health-extras.tsx, body-center.tsx, home-dashboard.tsx, styles.css |
| 2026-10-16 | 健康新增恢复趋势卡（睡眠/静息心率/HRV 来自佳明，疲劳/酸痛来自主观感受；7/30/90 天）；体重趋势与恢复趋势都支持双指缩放、横向拖动、点按看数值、双击复原（轻量 SVG）；sw → v32 | 用户要求 | trend-chart.tsx, home-dashboard.tsx |
| 2026-10-16 | 健康记录改为可选小格：佳明指标（睡眠/静息心率/HRV/压力/身体电量/呼吸/血氧/步数，有数据才可选）+主观（疲劳/酸痛/恢复状态，点开打分）；编辑勾选，存 fk-health-tiles-v1；点小格看可缩放趋势；去掉单独主观卡；佳明同步新增步数/血氧/呼吸；sw → v33 | 用户要求 | home-dashboard.tsx, garmin-sync.tsx, device-parse.ts, watch-mode.ts, body-center.tsx |
| 2026-10-16 | 记录饮食改为正式底部面板（暗色遮罩、圆角+拖柄+标题+关闭、随键盘上移、锁背景滚动、拍照与记录同一行）；体重变化详情重做：多指标叠加勾选（体重/体脂率/肌肉量/内脏脂肪/水分/基础代谢，各自缩放）、周/月/半年/年、大图可缩放拖动点按、历史可编辑删除、+记录；健康小格详情加时间段与历史列表；sw → v34 | 用户反馈 | home-dashboard.tsx, trend-chart.tsx |
