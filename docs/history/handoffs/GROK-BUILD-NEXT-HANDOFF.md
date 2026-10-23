# 跑步力量 — Grok Build 接力交付（PWA 缓存安全候选版）

## 输入与优先级
本 ZIP 为完整源码候选包，在运动目标扩展版副本上追加 PWA Service Worker 缓存安全改动。以本 ZIP 内源码为开发输入，不要以线上现有部署覆盖本 ZIP 的改动。保留冻结基线包和原扩展包作为不可变回退基线。禁止清理、重置、迁移或覆盖用户手机 localStorage、IndexedDB 和训练事实。不得擅自发布。

## 已完成的源码变更
- `public/sw.js`：阻止 ZIP/TAR/GZ/7Z/PDF/CSV/JSON/JSONL 等下载文件进入 SW 缓存；只缓存合法 JavaScript MIME 的脚本响应；尊重 `Cache-Control: no-store`。
- `scripts/sw-archive-safety.test.mjs` 与 `scripts/sw-cache-integrity.test.mjs`：新增缓存策略回归测试。
- 未修改 AI 大脑、训练决策规则或既有用户记录结构。

## Grok 下一步必须执行
1. 在**独立构建目录**解压本 ZIP，记录 `sha256sum`；检查是否存在密钥或环境文件，不得将真实密钥写入产物。
2. 执行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`；逐项报告 PASS/FAIL 与实际测试数。任何失败先定位原因，不得虚报通过。
3. 专门验证 SW：脚本 200+text/html 不进入缓存；no-store 不缓存；ZIP 不拦截；正常 JS 可缓存；网络失败且已有正确缓存时可恢复；网络失败无缓存时正确返回错误。
4. 检查线上旧 SW 与新 SW 的版本兼容、首次安装/刷新风险，**不允许**以清除用户浏览器数据作为修复方法。
5. 输出可复现构建报告、风险清单、变更文件与哈希、真机测试清单。iPhone 真机 PWA 和飞行模式冷启动未实际测则写 NOT TESTED。
6. 构建成功后**先停下等待确认**，不要部署到 `https://lake-blend-fleet-ever.grok.me/`；该地址当前承载用户已有本地记录。

## 验收边界
现阶段只能称开发候选版。完整回归、生产构建及真机测试以 Grok 实际执行结果为准。不要把旧版本 521/521 测试结果当作本候选版结果。若依赖安装失败，标记 BLOCKED 并给出确切失败信息。
