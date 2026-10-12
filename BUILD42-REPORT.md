# BUILD 42 · 设备证据备份 UI 候选

基线：BUILD41完整候选源码。修改 `src/components/device-evidence-import.tsx`，将 BUILD41 的证据备份/恢复底层 API 接入用户可见页面。

- 全量导出：独立 IndexedDB 设备证据及原图，生成 JSON 文件；明确提示包含敏感健康数据且未加密。
- 导入：最大50MB文件、JSON/schema验证、数量与原图统计预览；复选框明确确认后才调用恢复。
- 恢复：已有 ID 跳过、不覆盖；恢复结果提示新增/重复；中途失败提示可能部分写入，可重试。
- 不触碰正式训练历史、身体正式数据、计划或伤病阻断；未部署。
- 测试：设备备份和图像解析定向测试 38/38 PASS（Node 原生 TypeScript strip-types）；详见 BUILD42-TESTS.log。
- 限制：UI未做真实浏览器/手机交互验证，未完成 TypeScript typecheck 或 production build（node_modules缺失）。本地 OCR 仍依赖浏览器 TextDetector，iPhone Safari 兼容性未解决；未接入联网识图服务。备份文件未加密，50MB导入限制可能无法恢复较大备份。BUILD42 为候选，不是最终发布验收。
