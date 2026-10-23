# 方坤 AI Brain 第三轮候选：400米使用验收

这是基于第二轮候选的真实代码增量，未发布、未覆盖正式版或个人训练数据。

先读 `docs/cognition-r3-delivery.md`。完整源码在本目录；实际检查日志、版本标识及浏览器阻断证据在交付包 `evidence/round3/`。浏览器验收仍为 BLOCKED，服务层模拟和 HTTP 不代表浏览器通过。

独立运行：Node 24；安装依赖后 `npm test`、`npm run test:domain`、`npm run typecheck`、`DATABASE_URL='' npm run build`。不要接正式数据库。原测试环境复用第二轮依赖，未重新执行干净安装。

只在独立 HTTPS 预览域名及空白浏览器资料中试用；不向正式域名导入测试数据，不清除原有浏览器数据。
