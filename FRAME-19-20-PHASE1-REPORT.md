# FRAME-19/20 第一阶段实施报告

状态：局部实现；未发布；未完成全量验收。

## FRAME-20
现有 `fr255-` JSON 完整备份/恢复功能保留。新增 `inspectLocalBackup()`，导入前只读检查备份格式与条目，区分新增、覆盖和相同数据。导入 UI 显示预览并要求用户确认；取消不写入。单文件大小限制 30 MB。注意：当前导入仍是按键覆盖，不是记录级智能合并；建议先下载现有备份。现有导出不会包含非 `fr255-` 命名空间的数据，需后续审计所有数据来源。未实现云端备份、ZIP、CSV 或自动备份。

## FRAME-19
新增 `fr255-goal-portfolio-v1` 存储多个并行目标，保留原 `fr255-sport-goal-v1` 主要/次要目标结构和既有行为。并行目标只做意向记录，不改变训练处方、热量目标或 AI Brain。新增入口在个人与数据 → 运动项目与目标。当前并行目标为预定义类型，尚未支持每目标独立期限/数值/历史，也不等同完整多目标引擎。

## 测试
`node --experimental-strip-types --test src/lib/core/backup-inspection.test.ts src/lib/ui/goal-portfolio.test.ts`：4/4 PASS。未运行 typecheck、生产构建、全量测试或手机真机测试（无 node_modules）。

## 数据安全
不清除旧 localStorage，不迁移或覆盖旧目标结构。导入仍可能覆盖同名键，必须提醒用户保留回退备份。不要在没有完整验收前发布覆盖线上版本。
