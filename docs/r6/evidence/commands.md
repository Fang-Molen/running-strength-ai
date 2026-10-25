# 本轮命令与执行口径

仓库根目录，Node 24.22.1。依赖来自锁文件，未升级依赖。

```sh
npm ci --ignore-scripts --prefer-offline --cache /opt/codex/cache/sites-tanstack-npm
# 完整 npm test 的 17 个 && 分组逐组执行，失败后继续收集其余组；顺序及计数见 full-regression.jsonl
node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs --test --test-concurrency=3 src/lib/coach/cycle/*.test.ts
node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs --test --test-concurrency=3 src/lib/coach/online-chat-transport.test.ts src/lib/ui/schedule-writer.test.ts
node --import ./evaluation/deepseek-development/no-network.mjs --import ./scripts/test-register.mjs evaluation/cycle/replay.ts
node node_modules/typescript/bin/tsc --noEmit
npm run build
node evaluation/cycle/browser.mjs
node scripts/browser-smoke.mjs http://127.0.0.1:8080 /workspace/screenshots/r6/smoke-dev.png
node scripts/browser-smoke.mjs http://127.0.0.1:8081 /workspace/screenshots/r6/smoke-built.png --baseline /workspace/screenshots/r6/smoke-dev.json
git diff --check
```

`npm run test:cycle` 与 `npm run replay:cycle` 提供同等仓库入口。最终记录采用上列直接 node 命令，避免 npm 包装层空日志被误报为一次新测试。

页面实际运行使用 Playwright 与现成 Chromium；本机网络接口查询受限，用测试专属 preload 只给 os.networkInterfaces 提供 loopback；不进产品代码。浏览器使用同一个隔离合成上下文，拦截 API 返回未连接状态、禁止真实模型，屏蔽 Service Worker 并设上海时区。服务器与浏览器在同一测试进程环境内运行。运行时专用参数不代表真实用户设置。

基线复现：独立复制文本源码，并将所有修改的原有 src 文件恢复为 git show c8053c8:path；复制测试 loader 使 @/ 指向该副本。只运行上述五个失败所在文件，得到35/5，不重复全量测试。两个资源失败未修改断言，远端同一SHA二进制保持不动。

归档日志只规范化行尾空格，未删改测试结果。
