> 本文是上一轮历史入口；当前请先阅读 [UI-20261016-先读我.md](UI-20261016-先读我.md)。

# 当前交付入口

最新交付说明在 [docs/fieldwork-v4/Codex-交付说明.md](docs/fieldwork-v4/Codex-交付说明.md)，含真实截图、模块关联、人物资产校验值、修改清单、测试边界和回退说明。

同目录 `验收结果.json` 是本轮实际测试结果。其他目录中的旧报告、模板和“待定稿”文件为历史阶段档案，不能替代本轮验收结果，也不能把旧测试数量加成本轮通过数量。

完整源码 ZIP 已包含原人物、动作、方坤立绘和新版参考图。若使用三个较小的独立 ZIP，须全部解压到同一父目录，合并同一个 `source/`。它们是互补目录包，不是二进制分卷，不使用 `cat` 拼接；不能只解压代码包就认定人物资源缺失。

按原 package-lock 使用 Node 22。执行 `npm ci`、`npm run verify:fieldwork-assets`、`npm run typecheck`、`npm run build`。这些是接手者的复现命令，不代表本交付授权自动部署。

本包不包含 node_modules、构建缓存、真实 Garmin 导出、GPS 轨迹、身份资料或运行时密钥。不覆盖现有用户存储；不要为启动清空 localStorage。
