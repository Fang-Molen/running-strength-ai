# BUILD 41 · 设备证据便携备份候选

基线：BUILD40候选完整源码。新增 `src/lib/core/device-evidence-backup.ts` 和 5 条独立测试。

- 设备证据及原图以版本化 JSON+Base64 格式导出，保留原始记录，不触碰训练计划/身体正式数据。
- 导入先验证 schema、确认标记、数值区间、ID 去重、图片 MIME 与大小；必须由调用方先预览并明确传入 userConfirmed=true。
- 导入复用原有 IndexedDB 单条原子写入、已有 ID 不覆盖。单张图片最大15MiB，最多2000条记录。
- 尚未接入用户可见的备份导入导出按钮和预览 UI；不应把 API 当作已完成的用户功能。
- 多条导入并非整体事务；若中途存储失败，之前的条目可能已保存，重试可按 ID 去重。
- 本阶段5/5定向测试 PASS。未安装 node_modules，完整 typecheck、production build、浏览器和 iPhone 验收 NOT TESTED。
- 没有部署，没有修改原始 ZIP 或正式线上训练历史；原有伤病安全阻断未改变。

下一步：先接入确认预览 UI 与完整备份入口；进行浏览器 IDB 原图往返/多标签/配额失败测试；随后再做本地离线 OCR 适配和用户授权联网代理。
